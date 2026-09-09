import { afterEach, expect, test } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./helpers/cli";
import { git, initBareOrigin, initRepository } from "./helpers/git";

const temporary: string[] = [];

afterEach(() => {
	for (const path of temporary.splice(0))
		rmSync(path, { recursive: true, force: true });
});

function fixture(conflict = false, baseBranch = "main") {
	const dir = mkdtempSync(join(tmpdir(), "wts-restack-"));
	temporary.push(dir);
	const main = join(dir, "repo");
	const origin = join(dir, "origin.git");
	initRepository(main, baseBranch);
	writeFileSync(
		join(main, ".wts.json"),
		JSON.stringify({ baseBranch, naming: {} }),
	);
	writeFileSync(join(main, "shared"), "base\n");
	git(main, "add", ".");
	git(main, "commit", "-m", "base");
	initBareOrigin(main, origin, baseBranch);
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
	git(main, "push", "origin", baseBranch);
	const gitDir = git(worktree, "rev-parse", "--absolute-git-dir");
	writeFileSync(
		join(gitDir, "wts-session.json"),
		JSON.stringify({ rootBranch: root }),
	);
	return { main, origin, root, next, worktree, gitDir };
}

function run(worktree: string, args: string[] = []) {
	return runCli(worktree, ["restack", "--push", ...args]);
}

test("restack rebases every literal-root stack branch onto the configured base, pushes and restores checkout", () => {
	const f = fixture(false, "master");
	const unrelated = git(f.main, "rev-parse", "sessionXa-pr3-unrelated");
	const result = run(f.worktree);
	expect(result).toMatchObject({ code: 0 });
	expect(git(f.worktree, "branch", "--show-current")).toBe(f.root);
	for (const branch of [f.root, f.next]) {
		git(f.main, "merge-base", "--is-ancestor", "master", branch);
		expect(git(f.origin, "rev-parse", branch)).toBe(
			git(f.main, "rev-parse", branch),
		);
	}
	expect(git(f.main, "rev-parse", "sessionXa-pr3-unrelated")).toBe(unrelated);
	expect(existsSync(join(f.gitDir, "restack-lease"))).toBe(false);
});

test("restack explicit base overrides the configured project base", () => {
	const f = fixture(false, "master");
	git(f.main, "switch", "-c", "release/stable");
	writeFileSync(join(f.main, "release"), "release\n");
	git(f.main, "add", "release");
	git(f.main, "commit", "-m", "advance release base");
	git(f.main, "push", "origin", "release/stable");
	const result = run(f.worktree, ["--base-branch", "origin/release/stable"]);
	expect(result.code).toBe(0);
	for (const branch of [f.root, f.next]) {
		git(f.main, "merge-base", "--is-ancestor", "release/stable", branch);
		expect(git(f.origin, "rev-parse", branch)).toBe(
			git(f.main, "rev-parse", branch),
		);
	}
});

test("dry-run preserves refs, checkout and lease without fetching", () => {
	const f = fixture();
	const before = git(f.main, "show-ref");
	const remote = git(f.origin, "show-ref");
	const result = run(f.worktree, ["--dry-run"]);
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
	const rejected = run(f.worktree, ["--push-only"]);
	expect(rejected.code).toBe(1);
	expect(rejected.err).toContain("stale info");
	expect(git(f.origin, "show-ref")).toBe(remote);
	expect(readFileSync(join(f.gitDir, "restack-lease"), "utf8")).toBe(lease);
	const oldRoot = lease.split("\n")[0]?.split(" ")[1];
	if (!oldRoot) throw new Error("missing root lease");
	git(f.main, "push", "--force", "origin", `${oldRoot}:refs/heads/${f.root}`);
	expect(run(f.worktree, ["--push-only"]).code).toBe(0);
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

for (const noChanges of [false, true]) {
	test(`CLI refuses noninteractive restack before fetching, including no push targets: ${noChanges}`, () => {
		const f = fixture();
		if (noChanges) expect(run(f.worktree).code).toBe(0);
		const refs = git(f.main, "show-ref");
		const fetchHead = join(f.gitDir, "FETCH_HEAD");
		const fetchBefore = existsSync(fetchHead)
			? readFileSync(fetchHead, "utf8")
			: undefined;
		writeFileSync(join(f.gitDir, "restack-lease"), "unchanged");
		const result = runCli(f.worktree, ["restack"]);
		expect(result.code).not.toBe(0);
		expect(result.err).toContain("--push");
		expect(git(f.main, "show-ref")).toBe(refs);
		expect(readFileSync(join(f.gitDir, "restack-lease"), "utf8")).toBe(
			"unchanged",
		);
		expect(
			existsSync(fetchHead) ? readFileSync(fetchHead, "utf8") : undefined,
		).toBe(fetchBefore);
	});
}

test("CLI PUSH and DRY_RUN activate only with 1 and unset restores refusal", () => {
	const f = fixture();
	const refs = git(f.main, "show-ref");
	expect(runCli(f.worktree, ["restack"], { DRY_RUN: "1" }).code).toBe(0);
	expect(git(f.main, "show-ref")).toBe(refs);
	expect(existsSync(join(f.gitDir, "restack-lease"))).toBe(false);
	expect(
		runCli(f.worktree, ["restack"], { PUSH: "true", DRY_RUN: "true" }).code,
	).not.toBe(0);
	expect(runCli(f.worktree, ["restack"], { PUSH: "1" }).code).toBe(0);
	expect(git(f.origin, "rev-parse", f.root)).toBe(
		git(f.main, "rev-parse", f.root),
	);
	expect(runCli(f.worktree, ["restack"]).code).not.toBe(0);
});

test("CLI PUSH_ONLY uses saved lease without fetching or resolving a base", () => {
	const f = fixture();
	const leases = [f.root, f.next]
		.map((branch) => `${branch} ${git(f.origin, "rev-parse", branch)}\n`)
		.join("");
	writeFileSync(join(f.gitDir, "restack-lease"), leases);
	writeFileSync(join(f.worktree, "local"), "local\n");
	git(f.worktree, "add", "local");
	git(f.worktree, "commit", "-m", "local");
	git(f.worktree, "branch", "-f", f.next, f.root);
	writeFileSync(join(f.gitDir, "FETCH_HEAD"), "unchanged");
	const before = git(f.worktree, "rev-parse", "HEAD");
	const result = runCli(f.worktree, ["restack", "--base-branch", "missing"], {
		PUSH: "1",
		PUSH_ONLY: "1",
	});
	expect(result.code).toBe(0);
	expect(readFileSync(join(f.gitDir, "FETCH_HEAD"), "utf8")).toBe("unchanged");
	expect(git(f.origin, "rev-parse", f.root)).toBe(before);
	expect(git(f.worktree, "rev-parse", "HEAD")).toBe(before);
	expect(existsSync(join(f.gitDir, "restack-lease"))).toBe(false);
	expect(
		runCli(f.worktree, ["restack", "--base-branch", "missing"], { PUSH: "1" })
			.code,
	).not.toBe(0);
});
