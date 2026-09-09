import { expect, test } from "bun:test";
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	rmSync,
	realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, initRepository } from "./helpers/git";
import { runCli } from "./helpers/cli";

test("list shows multiple sessions, dirty ignored files and unmanaged metadata without communication", () => {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "wts-list-")));
	try {
		const root = join(dir, "repo");
		initRepository(root);
		writeFileSync(join(root, ".wts.json"), JSON.stringify({ naming: {} }));
		writeFileSync(join(root, ".gitignore"), "ignored\n");
		git(root, "add", ".");
		git(root, "commit", "-m", "base");
		for (const name of ["one", "two", "manual", "broken"]) {
			const path = join(dir, "repo-worktrees", name);
			git(root, "worktree", "add", "-b", name, path);
			if (name !== "manual")
				writeFileSync(
					join(
						git(path, "rev-parse", "--absolute-git-dir"),
						"wts-session.json",
					),
					name === "broken" ? "{" : JSON.stringify({ rootBranch: name }),
				);
		}
		const one = join(dir, "repo-worktrees", "one");
		git(one, "switch", "-c", "one-pr2-followup");
		writeFileSync(join(one, "ignored"), "dirty");
		const outside = join(dir, "outside");
		git(root, "worktree", "add", "-b", "outside", outside);
		const bin = join(dir, "bin");
		mkdirSync(bin);
		const realGit = Bun.which("git");
		writeFileSync(
			join(bin, "git"),
			`#!${process.execPath}\nconst args = process.argv.slice(2); if (args.some(a => ["fetch", "push", "ls-remote"].includes(a))) throw new Error("network forbidden"); const r = Bun.spawnSync([${JSON.stringify(realGit)}, ...args], {stdin:"inherit",stdout:"inherit",stderr:"inherit"}); process.exit(r.exitCode);\n`,
			{ mode: 0o755 },
		);
		const before = git(root, "show-ref");
		const result = runCli(root, ["list"], {
			PATH: `${bin}:${process.env.PATH}`,
		});
		expect(result.code).toBe(0);
		expect(result.out).toContain(one);
		expect(result.out).toMatch(/Root\s+one/);
		expect(result.out).toContain("2: one-pr2-followup");
		expect(result.out).toMatch(/Current\s+one-pr2-followup/);
		expect(result.out).toContain("--force");
		expect(result.out).toContain("なし");
		expect(result.out.match(/未管理/g)?.length).toBe(2);
		expect(result.out).not.toContain(outside);
		expect(git(root, "show-ref")).toBe(before);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
