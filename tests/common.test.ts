import { expect, test } from "bun:test";
import { Git, localBranches, worktrees } from "../src/git";
import { command, commandAsync } from "../src/process";
import { supportsUpdateRefs } from "../src/git-version";
import { isSameOrDescendant } from "../src/path";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, initRepository } from "./helpers/git";

test("process executor preserves whitespace while Git string APIs trim it", async () => {
	const args = [
		"-e",
		'process.stdout.write("value \\n\\t"); process.stderr.write("error \\n")',
	];
	for (const result of [
		command(process.execPath, args, process.cwd()),
		await commandAsync(process.execPath, args, process.cwd()),
	]) {
		expect(result).toEqual({ code: 0, out: "value \n\t", err: "error \n" });
	}
	const g = new Git();
	expect(g.tryRun(["--version"]).out).not.toEndWith("\n");
	expect((await g.tryRunAsync(["--version"])).out).not.toEndWith("\n");
});
test("path inclusion accepts the same path and descendants only", () => {
	expect(isSameOrDescendant("/a/b", "/a/b")).toBe(true);
	expect(isSameOrDescendant("/a/b/c", "/a/b")).toBe(true);
	expect(isSameOrDescendant("/a/bc", "/a/b")).toBe(false);
	expect(isSameOrDescendant("/a", "/a/b")).toBe(false);
});
test("update-refs supports Git 2.38 and later including Apple versions", () => {
	for (const text of [
		"git version 2.38.0",
		"git version 2.50.1 (Apple Git-155)",
		"git version 3.0.0",
	])
		expect(supportsUpdateRefs(text)).toBe(true);
	for (const text of ["git version 2.37.9", "git version 1.99.0", "invalid"])
		expect(supportsUpdateRefs(text)).toBe(false);
});
test("worktree enumeration returns path branch and lock state together", () => {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "wts-worktrees-")));
	try {
		initRepository(dir);
		git(dir, "commit", "--allow-empty", "-m", "base");
		const target = join(dir, "locked tree");
		git(dir, "worktree", "add", "-b", "session", target);
		git(dir, "worktree", "lock", "--reason", "test", target);
		expect(worktrees(new Git(dir)).find((t) => t.branch === "session")).toEqual(
			{ path: target, branch: "session", locked: true },
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("local branch snapshots preserve exact names and refresh OIDs independently of tags", () => {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "wts-refs-")));
	try {
		initRepository(dir);
		git(dir, "commit", "--allow-empty", "-m", "base");
		const branch = "feature/日本語";
		git(dir, "branch", branch);
		git(dir, "tag", branch);
		const old = git(dir, "rev-parse", "HEAD");
		const before = localBranches(new Git(dir));
		expect(before.get(branch)).toBe(old);
		expect([...before.keys()]).toEqual([branch, "main"]);
		git(dir, "commit", "--allow-empty", "-m", "advance");
		git(dir, "branch", "-f", branch, "HEAD");
		const after = localBranches(new Git(dir));
		expect(after.get(branch)).toBe(git(dir, "rev-parse", "HEAD"));
		expect(before.get(branch)).toBe(old);
		expect(git(dir, "rev-parse", `refs/tags/${branch}`)).toBe(old);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
