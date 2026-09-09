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

test("remote discard deletes the same-name session refs and preserves unrelated branches", () => {
	const f = fixture();
	try {
		f.git("push", "origin", "unrelated");
		const unrelated = f.git("ls-remote", "origin", "refs/heads/unrelated");
		const main = f.git("ls-remote", "origin", "refs/heads/main");
		const result = f.run(["--remote", "origin", "--yes"]);
		expect(result.code).toBe(0);
		expect(existsSync(f.target)).toBe(false);
		expect(f.git("branch", "--format=%(refname:short)").split("\n")).toEqual([
			"main",
			"unrelated",
		]);
		expect(
			f.git(
				"ls-remote",
				"origin",
				"refs/heads/session",
				"refs/heads/session-pr2-followup",
			),
		).toBe("");
		expect(f.git("ls-remote", "origin", "refs/heads/unrelated")).toBe(
			unrelated,
		);
		expect(f.git("ls-remote", "origin", "refs/heads/main")).toBe(main);
	} finally {
		f.dispose();
	}
});

test("remote discard dry-run displays remote members without changing local or remote refs", () => {
	const f = fixture();
	try {
		const before = f.snapshot();
		const result = f.run(["--remote", "origin", "--dry-run"]);
		expect(result.code).toBe(0);
		for (const member of ["origin", "session", "session-pr2-followup"])
			expect(result.text).toContain(member);
		expect(f.snapshot()).toEqual(before);
		expect(existsSync(f.target)).toBe(true);
	} finally {
		f.dispose();
	}
});

for (const missing of [["session"], ["session", "session-pr2-followup"]]) {
	test(`remote discard skips absent refs: ${missing.join(", ")}`, () => {
		const f = fixture();
		try {
			f.git("push", "origin", "--delete", ...missing);
			expect(f.run(["--remote", "origin", "--yes"]).code).toBe(0);
			expect(existsSync(f.target)).toBe(false);
			expect(
				f.git(
					"ls-remote",
					"origin",
					"refs/heads/session",
					"refs/heads/session-pr2-followup",
				),
			).toBe("");
		} finally {
			f.dispose();
		}
	});
}

test("remote discard rejects an unconfigured remote without deleting the session", () => {
	const f = fixture();
	try {
		const before = f.snapshot();
		expect(f.run(["--remote", "unknown", "--yes"]).code).not.toBe(0);
		expect(f.snapshot()).toEqual(before);
		expect(existsSync(f.target)).toBe(true);
	} finally {
		f.dispose();
	}
});

test("remote rejection preserves every remote ref and the local session", () => {
	const f = fixture();
	try {
		const remote = f.git("remote", "get-url", "--push", "origin");
		writeFileSync(join(remote, "hooks", "pre-receive"), "#!/bin/sh\nexit 1\n", {
			mode: 0o755,
		});
		const before = f.snapshot();
		expect(f.run(["--remote", "origin", "--yes"]).code).not.toBe(0);
		expect(f.snapshot()).toEqual(before);
		expect(existsSync(f.target)).toBe(true);
	} finally {
		f.dispose();
	}
});

test("a remote ref changed after planning prevents atomic deletion of the entire session", () => {
	const f = fixture();
	try {
		const gitPath = Bun.which("git");
		if (!gitPath) throw new Error("Git is required for this test");
		const remote = f.git("remote", "get-url", "origin");
		const changedOid = f.git("rev-parse", "main");
		const bin = join(f.dir, "bin");
		mkdirSync(bin);
		writeFileSync(
			join(bin, "git"),
			`#!${process.execPath}
const args = process.argv.slice(2);
if (args.includes("push")) {
  const update = Bun.spawnSync([${JSON.stringify(gitPath)}, "--git-dir", ${JSON.stringify(remote)}, "update-ref", "refs/heads/session", ${JSON.stringify(changedOid)}]);
  if (update.exitCode) process.exit(update.exitCode);
}
const result = Bun.spawnSync([${JSON.stringify(gitPath)}, ...args], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
process.exit(result.exitCode);
`,
			{ mode: 0o755 },
		);
		const before = f.snapshot();
		const stackBefore = f.git(
			"ls-remote",
			"origin",
			"refs/heads/session-pr2-followup",
		);
		const result = f.run(["--remote", "origin", "--yes"], f.target, f.root, {
			PATH: `${bin}:${process.env.PATH}`,
		});
		expect(result.code).not.toBe(0);
		expect(f.git("show-ref")).toBe(before.refs);
		expect(f.git("worktree", "list", "--porcelain")).toBe(before.worktrees);
		expect(existsSync(f.target)).toBe(true);
		expect(f.git("ls-remote", "origin", "refs/heads/session")).toBe(
			`${changedOid}\trefs/heads/session`,
		);
		expect(
			f.git("ls-remote", "origin", "refs/heads/session-pr2-followup"),
		).toBe(stackBefore);
	} finally {
		f.dispose();
	}
});

test("remote discard uses the push URL while preserving the fetch repository", () => {
	const f = fixture();
	try {
		const pushRemote = join(f.dir, "push.git");
		f.git("init", "--bare", pushRemote);
		f.git("push", pushRemote, "session", "session-pr2-followup");
		f.git("remote", "set-url", "--push", "origin", pushRemote);
		const fetchBefore = f.git("ls-remote", "origin");
		expect(f.run(["--remote", "origin", "--yes"]).code).toBe(0);
		expect(existsSync(f.target)).toBe(false);
		expect(
			f.git(
				"ls-remote",
				pushRemote,
				"refs/heads/session",
				"refs/heads/session-pr2-followup",
			),
		).toBe("");
		expect(f.git("ls-remote", "origin")).toBe(fetchBefore);
	} finally {
		f.dispose();
	}
});

test("remote discard rejects multiple push URLs before deleting anything", () => {
	const f = fixture();
	try {
		const origin = f.git("remote", "get-url", "origin");
		const other = join(f.dir, "other.git");
		f.git("init", "--bare", other);
		f.git("push", other, "session", "session-pr2-followup");
		f.git("remote", "set-url", "--push", "origin", origin);
		f.git("remote", "set-url", "--add", "--push", "origin", other);
		const before = f.snapshot();
		const otherBefore = f.git("ls-remote", other);
		expect(f.run(["--remote", "origin", "--yes"]).code).not.toBe(0);
		expect(f.snapshot()).toEqual(before);
		expect(f.git("ls-remote", other)).toBe(otherBefore);
		expect(existsSync(f.target)).toBe(true);
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

for (const remote of [false, true]) {
	test(`worktree removal failure preserves every local session branch${remote ? " and reports completed remote deletion" : ""}`, () => {
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
			const result = f.run(
				["--yes", ...(remote ? ["--remote", "origin"] : [])],
				f.target,
				f.root,
				{ PATH: `${bin}:${process.env.PATH}` },
			);
			expect(result.code).not.toBe(0);
			expect(f.git("show-ref")).toBe(before.refs);
			expect(f.git("worktree", "list", "--porcelain")).toBe(before.worktrees);
			if (remote) {
				expect(result.text).toContain("リモートブランチは削除済み");
				expect(
					f.git(
						"ls-remote",
						"origin",
						"refs/heads/session",
						"refs/heads/session-pr2-followup",
					),
				).toBe("");
			} else {
				expect(f.git("ls-remote", "origin")).toBe(before.remote);
			}
			expect(existsSync(f.target)).toBe(true);
		} finally {
			f.dispose();
		}
	});
}

const terminalTest = process.platform === "darwin" ? test : test.skip;
for (const remote of [false, true]) {
	for (const [name, input, deleted] of [
		["yes", "\u001b[D\r", true],
		["no", "\r", false],
		["Ctrl-C", "\u0003", false],
	] as const) {
		terminalTest(
			`discard${remote ? " --remote origin" : ""} confirmation handles ${name} in a real terminal`,
			async () => {
				const f = fixture();
				let output = "";
				let answered = false;
				const decoder = new TextDecoder();
				const closed = Promise.withResolvers<void>();
				const before = f.snapshot();
				const child = Bun.spawn(
					[
						process.execPath,
						cli,
						"discard",
						f.target,
						...(remote ? ["--remote", "origin"] : []),
					],
					{
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
					},
				);
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
}
