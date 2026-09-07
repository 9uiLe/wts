import { afterEach, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const dirs: string[] = [];
const modulePath = resolve(import.meta.dir, "../src/cli.ts");
afterEach(() => {
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});
function git(cwd: string, ...args: string[]) {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args]);
	if (result.exitCode !== 0) throw new Error(result.stderr.toString());
	return result.stdout.toString().trim();
}
function fixture() {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "wts-start-")));
	dirs.push(dir);
	const main = join(dir, "repo");
	mkdirSync(main);
	git(main, "init", "-b", "main");
	git(main, "config", "user.email", "test@example.invalid");
	git(main, "config", "user.name", "Test");
	writeFileSync(join(main, "tracked"), "initial");
	git(main, "add", ".");
	git(main, "commit", "-m", "initial");
	return { dir, main };
}
function run(cwd: string, method: string, options: object) {
	const result = Bun.spawnSync(
		[
			process.execPath,
			modulePath,
			method === "startWorktreeSession"
				? "start-worktree-session"
				: "start-stack-branch",
			...Object.entries(options).flatMap(([key, value]) => {
				const flag = `--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
				return typeof value === "boolean"
					? value
						? [flag]
						: []
					: [flag, String(value)];
			}),
		],
		{ cwd },
	);
	return {
		code: result.exitCode,
		out: result.stdout.toString(),
		err: result.stderr.toString(),
	};
}
function createdPath(out: string) {
	const path = out.match(/^Path\s+(.+)$/m)?.[1];
	if (!path) throw new Error(out);
	return path;
}

test("worktree creation copies glob entries from base worktree and protects .git and symlink destinations", () => {
	const { main, dir } = fixture();
	const base = join(dir, "base");
	git(main, "worktree", "add", "-b", "feature", base);
	mkdirSync(join(base, "settings", "person"), { recursive: true });
	writeFileSync(join(base, "settings", "person", "config"), "latest");
	writeFileSync(join(base, "secret"), "base-secret");
	const outside = join(dir, "outside");
	mkdirSync(outside);
	writeFileSync(join(outside, "secret"), "unchanged");
	symlinkSync(outside, join(main, "escape"));
	git(main, "add", "escape");
	git(main, "commit", "-m", "link");
	git(base, "merge", "main");
	mkdirSync(join(base, "safe"));
	symlinkSync(outside, join(base, "safe", "link"));
	writeFileSync(
		join(main, ".worktree-copy"),
		"settings/*/\n.git\n../outside\nsafe\n",
	);
	const result = run(main, "startWorktreeSession", {
		task: "",
		baseBranch: "feature",
	});
	expect(result.code).toBe(0);
	const target = createdPath(result.out);
	expect(
		readFileSync(join(target, "settings", "person", "config"), "utf8"),
	).toBe("latest");
	expect(readFileSync(join(target, ".git"), "utf8")).toStartWith("gitdir:");
	expect(existsSync(join(target, "safe", "link"))).toBe(false);
	expect(readFileSync(join(outside, "secret"), "utf8")).toBe("unchanged");
	expect(result.err).toContain(".git");
	expect(git(target, "rev-parse", "HEAD")).toBe(git(base, "rev-parse", "HEAD"));
});

test("dry-run leaves branches and worktrees unchanged; invalid base fails", () => {
	const { main } = fixture();
	const before = git(main, "show-ref");
	const result = run(main, "startWorktreeSession", {
		task: "",
		baseBranch: "main",
		dryRun: true,
	});
	expect(result.code).toBe(0);
	expect(result.out).toContain("dry-run");
	expect(existsSync(createdPath(result.out))).toBe(false);
	expect(git(main, "show-ref")).toBe(before);
	expect(
		run(main, "startWorktreeSession", { task: "", baseBranch: "--help" }).code,
	).not.toBe(0);
	expect(
		run(main, "startWorktreeSession", { task: "", baseBranch: "missing" }).code,
	).not.toBe(0);
});

test("stack creation stays in worktree and rejects duplicate numbers, dirty state, and non-tip checkout", () => {
	const { main } = fixture();
	const root = "20260908-session";
	const wt = `${main}-worktrees/${root}`;
	git(main, "worktree", "add", "-b", root, wt);
	const before = git(wt, "rev-parse", "HEAD");
	const dry = run(wt, "startStackBranch", {
		task: "",
		prNumber: "2",
		dryRun: true,
	});
	expect(dry.code).toBe(0);
	expect(git(wt, "branch", "--show-current")).toBe(root);
	const result = run(wt, "startStackBranch", { task: "", prNumber: "2" });
	expect(result.code).toBe(0);
	expect(git(wt, "branch", "--show-current")).toMatch(
		/^20260908-session-pr2-\d{6}$/,
	);
	expect(git(wt, "rev-parse", "HEAD")).toBe(before);
	expect(
		run(wt, "startStackBranch", { task: "", prNumber: "02" }).err,
	).toContain("既に");
	expect(
		run(wt, "startStackBranch", { task: "", prNumber: "1" }).code,
	).not.toBe(0);
	writeFileSync(join(wt, "dirty"), "dirty");
	expect(
		run(wt, "startStackBranch", { task: "", prNumber: "3" }).code,
	).not.toBe(0);
	rmSync(join(wt, "dirty"));
	git(wt, "checkout", root);
	expect(
		run(wt, "startStackBranch", { task: "", prNumber: "3" }).err,
	).toContain("先端");
	expect(
		run(main, "startStackBranch", { task: "", prNumber: "2" }).code,
	).not.toBe(0);
});

test("explicit copy source overrides base worktree", () => {
	const { main, dir } = fixture();
	const copy = join(dir, "copy");
	mkdirSync(copy);
	writeFileSync(join(copy, "config"), "explicit");
	writeFileSync(join(main, ".worktree-copy"), "config");
	const result = run(main, "startWorktreeSession", {
		task: "",
		baseBranch: "main",
		copyFrom: copy,
	});
	expect(result.code).toBe(0);
	expect(readFileSync(join(createdPath(result.out), "config"), "utf8")).toBe(
		"explicit",
	);
});
