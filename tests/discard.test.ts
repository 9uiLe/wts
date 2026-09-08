import { expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Git } from "../src/git";
import { recordSession } from "../src/session";

const cli = resolve(import.meta.dir, "../src/cli.ts");

function fixture() {
	const dir = mkdtempSync(join(tmpdir(), "wts-discard-"));
	const root = join(dir, "repo");
	const target = join(dir, "repo-worktrees", "session");
	const remote = join(dir, "origin.git");
	mkdirSync(root);
	const env = {
		...process.env,
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_AUTHOR_NAME: "Test",
		GIT_AUTHOR_EMAIL: "test@example.com",
		GIT_COMMITTER_NAME: "Test",
		GIT_COMMITTER_EMAIL: "test@example.com",
	};
	function git(...args: string[]) {
		const result = Bun.spawnSync(["git", ...args], { cwd: root, env });
		if (result.exitCode) throw new Error(result.stderr.toString());
		return result.stdout.toString().trim();
	}
	git("init", "-b", "main");
	git("init", "--bare", remote);
	writeFileSync(join(root, ".wts.json"), JSON.stringify({ naming: {} }));
	writeFileSync(join(root, ".gitignore"), "ignored\n");
	writeFileSync(join(root, "file"), "base\n");
	git("add", ".");
	git("commit", "-m", "base");
	git("remote", "add", "origin", remote);
	git("push", "-u", "origin", "main");
	git("worktree", "add", "-b", "session", target);
	recordSession(new Git(root), target, "session");
	writeFileSync(join(target, "file"), "unmerged work\n");
	git("-C", target, "commit", "-am", "session work");
	git("-C", target, "switch", "-c", "session-pr2-followup");
	git("branch", "unrelated");
	git("push", "origin", "session", "session-pr2-followup");
	const metadata = join(
		git("-C", target, "rev-parse", "--absolute-git-dir"),
		"wts-session.json",
	);
	function snapshot() {
		return {
			refs: git("show-ref"),
			worktrees: git("worktree", "list", "--porcelain"),
			remote: git("ls-remote", "origin"),
		};
	}
	function run(
		args: string[] = [],
		path = target,
		cwd = root,
		extra: Record<string, string> = {},
	) {
		const result = Bun.spawnSync(
			[process.execPath, cli, "discard", path, ...args],
			{ cwd, env: { ...env, ...extra } },
		);
		return {
			code: result.exitCode,
			text: result.stdout.toString() + result.stderr.toString(),
		};
	}
	return {
		dir,
		root,
		target,
		metadata,
		env,
		git,
		run,
		snapshot,
		dispose: () => rmSync(dir, { recursive: true, force: true }),
	};
}

test("discard removes the entire unmerged local session and preserves unrelated and remote branches", () => {
	const f = fixture();
	try {
		const remote = f.git("ls-remote", "origin");
		const unrelated = f.git("rev-parse", "unrelated");
		const result = f.run(["--yes"]);
		expect(result.code).toBe(0);
		expect(existsSync(f.target)).toBe(false);
		expect(f.git("branch", "--format=%(refname:short)").split("\n")).toEqual([
			"main",
			"unrelated",
		]);
		expect(f.git("rev-parse", "unrelated")).toBe(unrelated);
		expect(f.git("ls-remote", "origin")).toBe(remote);
		expect(f.git("worktree", "list", "--porcelain")).not.toContain(f.target);
	} finally {
		f.dispose();
	}
});

test("dry-run lists all session members and preserves dirty worktrees and refs", () => {
	const f = fixture();
	try {
		writeFileSync(join(f.target, "untracked"), "keep me");
		const before = f.snapshot();
		const result = f.run(["--dry-run"]);
		expect(result.code).toBe(0);
		for (const member of [f.target, "session", "session-pr2-followup"])
			expect(result.text).toContain(member);
		expect(f.snapshot()).toEqual(before);
		expect(existsSync(join(f.target, "untracked"))).toBe(true);
	} finally {
		f.dispose();
	}
});

for (const file of ["file", "untracked", "ignored"]) {
	test(`discard requires force to delete ${file} content even with yes`, () => {
		const f = fixture();
		try {
			writeFileSync(join(f.target, file), "unsaved work");
			const before = f.snapshot();
			expect(f.run(["--yes"]).code).not.toBe(0);
			expect(f.snapshot()).toEqual(before);
			expect(existsSync(join(f.target, file))).toBe(true);
			expect(f.run(["--force", "--yes"]).code).toBe(0);
			expect(existsSync(f.target)).toBe(false);
			expect(f.git("branch", "--format=%(refname:short)").split("\n")).toEqual([
				"main",
				"unrelated",
			]);
		} finally {
			f.dispose();
		}
	});
}

test("discard requires explicit consent without a terminal", () => {
	const f = fixture();
	try {
		const before = f.snapshot();
		const result = f.run();
		expect(result.code).not.toBe(0);
		expect(result.text).toContain("--yes");
		expect(f.snapshot()).toEqual(before);
	} finally {
		f.dispose();
	}
});

for (const scenario of [
	"main",
	"subdirectory",
	"inside",
	"unmanaged",
	"outside",
	"invalid metadata",
	"base branch",
	"other worktree",
	"locked",
] as const) {
	test(`discard protects ${scenario} even with force and yes`, () => {
		const f = fixture();
		try {
			let path = f.target;
			let cwd = f.root;
			switch (scenario) {
				case "main":
					path = f.root;
					break;
				case "subdirectory":
					path = join(f.target, "sub");
					mkdirSync(path);
					break;
				case "inside":
					cwd = f.target;
					break;
				case "unmanaged":
					rmSync(f.metadata);
					break;
				case "outside":
					path = join(f.dir, "outside");
					f.git("worktree", "add", "-b", "external", path);
					recordSession(new Git(f.root), path, "external");
					break;
				case "invalid metadata":
					writeFileSync(f.metadata, "{");
					break;
				case "base branch":
					writeFileSync(f.metadata, JSON.stringify({ rootBranch: "main" }));
					break;
				case "other worktree":
					f.git("worktree", "add", join(f.dir, "second"), "session");
					break;
				case "locked":
					f.git("worktree", "lock", f.target);
					break;
			}
			const before = f.snapshot();
			expect(f.run(["--yes", "--force"], path, cwd).code).not.toBe(0);
			expect(f.snapshot()).toEqual(before);
			expect(existsSync(f.target)).toBe(true);
		} finally {
			f.dispose();
		}
	});
}

test("worktree removal failure preserves every session branch", () => {
	const f = fixture();
	try {
		const gitPath = Bun.which("git");
		if (!gitPath) throw new Error("Git is required for this test");
		const bin = join(f.dir, "bin");
		mkdirSync(bin);
		writeFileSync(
			join(bin, "git"),
			`#!${process.execPath}\nconst args = process.argv.slice(2); if (args.includes('worktree') && args.includes('remove')) { console.error('simulated removal failure'); process.exit(1); } const result = Bun.spawnSync([${JSON.stringify(gitPath)}, ...args], { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' }); process.exit(result.exitCode);\n`,
			{ mode: 0o755 },
		);
		const before = f.snapshot();
		expect(
			f.run(["--yes"], f.target, f.root, { PATH: `${bin}:${process.env.PATH}` })
				.code,
		).not.toBe(0);
		expect(f.snapshot()).toEqual(before);
		expect(existsSync(f.target)).toBe(true);
	} finally {
		f.dispose();
	}
});

const terminalTest = process.platform === "darwin" ? test : test.skip;
for (const [name, input, deleted] of [
	["yes", "\u001b[D\r", true],
	["no", "\r", false],
	["Ctrl-C", "\u0003", false],
] as const) {
	terminalTest(
		`discard confirmation handles ${name} in a real terminal`,
		async () => {
			const f = fixture();
			let output = "";
			let answered = false;
			const decoder = new TextDecoder();
			const closed = Promise.withResolvers<void>();
			const before = f.snapshot();
			const child = Bun.spawn([process.execPath, cli, "discard", f.target], {
				cwd: f.root,
				env: {
					...f.env,
					CI: undefined,
					NO_COLOR: undefined,
					FORCE_COLOR: "1",
					TERM: "xterm-256color",
				},
				terminal: {
					data(terminal, data) {
						output += decoder.decode(data, { stream: true });
						if (
							!answered &&
							output.includes("はい") &&
							output.includes("いいえ")
						) {
							answered = true;
							terminal.write(input);
						}
					},
					exit() {
						closed.resolve();
					},
				},
			});
			try {
				const [code] = await Promise.all([child.exited, closed.promise]);
				expect(answered).toBe(true);
				expect(code).toBe(0);
				expect(existsSync(f.target)).toBe(!deleted);
				if (!deleted) expect(f.snapshot()).toEqual(before);
			} finally {
				child.terminal?.close();
				if (child.exitCode === null) child.kill();
				f.dispose();
			}
		},
	);
}
