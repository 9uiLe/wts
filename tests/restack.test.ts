import { afterEach, expect, test } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const temporary: string[] = [];
const modulePath = resolve(import.meta.dir, "../src/commands/restack.ts");
const env = {
	...process.env,
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_AUTHOR_NAME: "Test",
	GIT_AUTHOR_EMAIL: "test@example.com",
	GIT_COMMITTER_NAME: "Test",
	GIT_COMMITTER_EMAIL: "test@example.com",
	GIT_EDITOR: "true",
};

afterEach(() => {
	for (const path of temporary.splice(0))
		rmSync(path, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]) {
	const result = Bun.spawnSync(["git", ...args], { cwd, env });
	if (result.exitCode !== 0) throw new Error(result.stderr.toString());
	return result.stdout.toString().trim();
}

function fixture(conflict = false) {
	const dir = mkdtempSync(join(tmpdir(), "wts-restack-"));
	temporary.push(dir);
	const main = join(dir, "repo");
	const origin = join(dir, "origin.git");
	git(dir, "init", "--bare", origin);
	git(dir, "init", "-b", "main", main);
	writeFileSync(join(main, ".wts.json"), JSON.stringify({ naming: {} }));
	writeFileSync(join(main, "shared"), "base\n");
	git(main, "add", ".");
	git(main, "commit", "-m", "base");
	git(main, "remote", "add", "origin", origin);
	git(main, "push", "-u", "origin", "main");
	const root = "session.a";
	const next = `${root}-pr2-second`;
	const worktree = join(`${main}-worktrees`, root);
	git(main, "worktree", "add", "-b", root, worktree);
	writeFileSync(join(worktree, conflict ? "shared" : "first"), "first\n");
	git(worktree, "add", ".");
	git(worktree, "commit", "-m", "first");
	git(worktree, "switch", "-c", next);
	writeFileSync(join(worktree, "second"), "second\n");
	git(worktree, "add", ".");
	git(worktree, "commit", "-m", "second");
	git(worktree, "push", "origin", root, next);
	git(worktree, "switch", root);
	git(main, "branch", "sessionXa-pr3-unrelated");
	writeFileSync(join(main, conflict ? "shared" : "upstream"), "upstream\n");
	git(main, "add", ".");
	git(main, "commit", "-m", "upstream");
	git(main, "push", "origin", "main");
	const gitDir = git(worktree, "rev-parse", "--absolute-git-dir");
	writeFileSync(
		join(gitDir, "wts-session.json"),
		JSON.stringify({ rootBranch: root }),
	);
	return { main, origin, root, next, worktree, gitDir };
}

function run(worktree: string, options: Record<string, unknown> = {}) {
	const script = `import { restack } from ${JSON.stringify(modulePath)}; await restack(${JSON.stringify({ baseBranch: "origin/main", push: true, ...options })});`;
	const result = Bun.spawnSync([process.execPath, "-e", script], {
		cwd: worktree,
		env,
	});
	return {
		code: result.exitCode,
		out: result.stdout.toString(),
		err: result.stderr.toString(),
	};
}

test("restack rebases every literal-root stack branch, pushes and restores checkout", () => {
	const f = fixture();
	const unrelated = git(f.main, "rev-parse", "sessionXa-pr3-unrelated");
	const result = run(f.worktree);
	expect(result).toMatchObject({ code: 0 });
	expect(git(f.worktree, "branch", "--show-current")).toBe(f.root);
	for (const branch of [f.root, f.next]) {
		git(f.main, "merge-base", "--is-ancestor", "main", branch);
		expect(git(f.origin, "rev-parse", branch)).toBe(
			git(f.main, "rev-parse", branch),
		);
	}
	expect(git(f.main, "rev-parse", "sessionXa-pr3-unrelated")).toBe(unrelated);
	expect(existsSync(join(f.gitDir, "restack-lease"))).toBe(false);
});

test("dry-run preserves refs, checkout and lease without fetching", () => {
	const f = fixture();
	const before = git(f.main, "show-ref");
	const remote = git(f.origin, "show-ref");
	const result = run(f.worktree, { dryRun: true });
	expect(result.code).toBe(0);
	expect(result.out).toContain("--atomic");
	expect(git(f.main, "show-ref")).toBe(before);
	expect(git(f.origin, "show-ref")).toBe(remote);
	expect(git(f.worktree, "branch", "--show-current")).toBe(f.root);
	expect(existsSync(join(f.gitDir, "restack-lease"))).toBe(false);
});

test("conflict recovery keeps original leases and atomic push rejects remote changes", () => {
	const f = fixture(true);
	const stopped = run(f.worktree);
	expect(stopped.code).toBe(1);
	expect(stopped.err).toContain("--push-only");
	const lease = readFileSync(join(f.gitDir, "restack-lease"), "utf8");
	expect(existsSync(join(f.gitDir, "rebase-merge"))).toBe(true);
	writeFileSync(join(f.worktree, "shared"), "resolved\n");
	git(f.worktree, "add", "shared");
	git(f.worktree, "rebase", "--continue");
	git(f.main, "push", "--force", "origin", `main:${f.root}`);
	const remote = git(f.origin, "show-ref");
	const rejected = run(f.worktree, { pushOnly: true });
	expect(rejected.code).toBe(1);
	expect(rejected.err).toContain("stale info");
	expect(git(f.origin, "show-ref")).toBe(remote);
	expect(readFileSync(join(f.gitDir, "restack-lease"), "utf8")).toBe(lease);
	const oldRoot = lease.split("\n")[0]?.split(" ")[1];
	if (!oldRoot) throw new Error("missing root lease");
	git(f.main, "push", "--force", "origin", `${oldRoot}:refs/heads/${f.root}`);
	expect(run(f.worktree, { pushOnly: true }).code).toBe(0);
	expect(existsSync(join(f.gitDir, "restack-lease"))).toBe(false);
});

test("restack refuses checked-out siblings and nonlinear stacks before changing refs", () => {
	const f = fixture();
	const other = join(`${f.main}-worktrees`, "other");
	git(f.main, "worktree", "add", other, f.next);
	expect(run(f.worktree).err).toContain("別の worktree");
	git(f.main, "worktree", "remove", other);
	git(f.main, "branch", "-f", f.next, "main");
	const before = git(f.main, "show-ref");
	expect(run(f.worktree).err).toContain("非線形");
	expect(git(f.main, "show-ref")).toBe(before);
	expect(existsSync(join(f.gitDir, "restack-lease"))).toBe(false);
});
