import { afterEach, expect, test } from "bun:test";
import {
	chmodSync,
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
import { join } from "node:path";
import { runCli } from "./helpers/cli";
import { git, initRepository } from "./helpers/git";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});
function fixture() {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "wts-start-")));
	dirs.push(dir);
	const main = join(dir, "repo");
	initRepository(main);
	writeFileSync(join(main, ".wts.json"), JSON.stringify({ naming: {} }));
	writeFileSync(join(main, "tracked"), "initial");
	git(main, "add", ".");
	git(main, "commit", "-m", "initial");
	return { dir, main };
}
function run(
	cwd: string,
	method: string,
	options: object,
	env: Record<string, string | undefined> = {},
) {
	return runCli(
		cwd,
		[
			method === "startWorktreeSession" ? "start" : "stack",
			...Object.entries(options).flatMap(([key, value]) => {
				const flag = `--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
				return typeof value === "boolean"
					? value
						? [flag]
						: []
					: [flag, String(value)];
			}),
		],
		env,
	);
}
function createdPath(out: string) {
	const path = out.match(/^Path\s+(.+)$/m)?.[1];
	if (!path) throw new Error(out);
	return path;
}

for (const source of ["config", "environment", "option"] as const) {
	test(`start creates a worktree from the ${source} base with option > environment > config precedence`, () => {
		const { main } = fixture();
		writeFileSync(
			join(main, ".wts.json"),
			JSON.stringify({ baseBranch: "master", naming: {} }),
		);
		git(main, "add", ".wts.json");
		git(main, "commit", "-m", "configure master base");
		git(main, "update-ref", "refs/remotes/origin/master", "HEAD");
		writeFileSync(join(main, "tracked"), "main ahead");
		git(main, "add", "tracked");
		git(main, "commit", "-m", "advance main");
		const result = run(
			main,
			"startWorktreeSession",
			{ task: "", ...(source === "option" ? { baseBranch: "main" } : {}) },
			{
				BASE_BRANCH:
					source === "environment"
						? "main"
						: source === "option"
							? "origin/master"
							: undefined,
			},
		);
		expect(result.code).toBe(0);
		expect(git(createdPath(result.out), "rev-parse", "HEAD")).toBe(
			git(main, "rev-parse", source === "config" ? "origin/master" : "main"),
		);
	});
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
	const started = run(main, "startWorktreeSession", {
		task: "",
		baseBranch: "main",
	});
	expect(started.code).toBe(0);
	const wt = createdPath(started.out);
	const root = git(wt, "branch", "--show-current");
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
	expect(git(wt, "branch", "--show-current")).toStartWith(`${root}-pr2-`);
	expect(
		git(wt, "branch", "--show-current").slice(`${root}-pr2-`.length),
	).toMatch(
		/^\d{8}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
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

function namingScript(dir: string, body: string): string {
	const script = join(dir, "naming script");
	writeFileSync(script, `#!${process.execPath}\n${body}`);
	chmodSync(script, 0o755);
	return script;
}

test("default worktree naming supports consecutive creations without invoking Claude", () => {
	const { main, dir } = fixture();
	const bin = join(dir, "bin");
	mkdirSync(bin);
	const marker = join(dir, "ai-called");
	const fake = join(bin, "claude");
	writeFileSync(
		fake,
		`#!${process.execPath}\nawait Bun.write(${JSON.stringify(marker)}, "called");`,
	);
	chmodSync(fake, 0o755);
	const results = ["one", "two"].map((task) =>
		runCli(main, ["start", "--task", task, "--base-branch", "main"], {
			PATH: `${bin}:${process.env.PATH}`,
		}),
	);
	for (const result of results) expect(result.code).toBe(0);
	expect(createdPath(results[0]?.out ?? "")).not.toBe(
		createdPath(results[1]?.out ?? ""),
	);
	expect(existsSync(marker)).toBe(false);
});

test("custom branch and worktree scripts receive task and prompt and determine separate names", () => {
	const { main, dir } = fixture();
	const script = namingScript(
		dir,
		'const input = await Bun.stdin.json(); await Bun.write(input.kind + ".json", JSON.stringify(input)); console.log(input.kind === "branch" ? "feature/custom" : "custom-directory");',
	);
	writeFileSync(
		join(main, ".wts.json"),
		JSON.stringify({
			naming: {
				branch: { script, prompt: "branch prompt" },
				worktree: { script, prompt: "directory prompt" },
			},
		}),
	);
	const result = run(main, "startWorktreeSession", {
		task: "my task",
		baseBranch: "main",
	});
	expect(result.code).toBe(0);
	const target = createdPath(result.out);
	expect(target).toBe(`${main}-worktrees/custom-directory`);
	expect(git(target, "branch", "--show-current")).toBe("feature/custom");
	for (const kind of ["branch", "worktree"]) {
		const received = JSON.parse(
			readFileSync(join(main, `${kind}.json`), "utf8"),
		);
		expect(received.task).toBe("my task");
		expect(received.prompt).toBe(
			kind === "branch" ? "branch prompt" : "directory prompt",
		);
	}
});

for (const [name, body] of [
	["empty", 'console.log("")'],
	["multiple lines", 'console.log("one\\ntwo")'],
	["nonzero exit", "process.exit(1)"],
	["invalid branch", 'console.log("invalid name")'],
] as const) {
	test(`invalid naming script (${name}) creates no branch or worktree`, () => {
		const { main, dir } = fixture();
		const script = namingScript(dir, body);
		writeFileSync(
			join(main, ".wts.json"),
			JSON.stringify({ naming: { branch: { script } } }),
		);
		const before = git(main, "show-ref");
		const result = run(main, "startWorktreeSession", {
			task: "",
			baseBranch: "main",
		});
		expect(result.code).not.toBe(0);
		expect(git(main, "show-ref")).toBe(before);
		expect(existsSync(`${main}-worktrees`)).toBe(false);
	});
}

test("branch and target collisions are rejected even on dry-run", () => {
	const { main, dir } = fixture();
	const script = namingScript(dir, 'console.log("main")');
	writeFileSync(
		join(main, ".wts.json"),
		JSON.stringify({ naming: { branch: { script } } }),
	);
	expect(
		run(main, "startWorktreeSession", {
			task: "",
			baseBranch: "main",
			dryRun: true,
		}).err,
	).toContain("既に");
	writeFileSync(
		script,
		`#!${process.execPath}\nconsole.log("existing-target");`,
	);
	mkdirSync(`${main}-worktrees/existing-target`, { recursive: true });
	expect(
		run(main, "startWorktreeSession", {
			task: "",
			baseBranch: "main",
			dryRun: true,
		}).err,
	).toContain("既に");
	expect(git(main, "branch", "--format=%(refname:short)")).toBe("main");
});

test("manually created worktrees are rejected as unmanaged sessions", () => {
	const { main } = fixture();
	const target = `${main}-worktrees/manual-session`;
	git(main, "worktree", "add", "-b", "manual-session", target);
	const before = git(main, "show-ref");
	for (const args of [
		["stack", "--task", "", "--pr-number", "2"],
		["restack", "--base-branch", "main", "--dry-run"],
	]) {
		const result = runCli(target, args);
		expect(result.code).toBe(1);
		expect(result.err).toContain("セッション");
	}
	expect(git(main, "show-ref")).toBe(before);
});

test("unreadable copy list fails before creating a branch or worktree", () => {
	const { main } = fixture();
	mkdirSync(join(main, ".worktree-copy"));
	const refs = git(main, "show-ref");
	const result = runCli(main, ["start", "--base-branch", "main"]);
	expect(result.code).not.toBe(0);
	expect(result.err).toContain("コピーリスト");
	expect(git(main, "show-ref")).toBe(refs);
	expect(existsSync(`${main}-worktrees`)).toBe(false);
});

test("copy dry-run and execution reject symlinks, special files and boundaries consistently", () => {
	const { main, dir } = fixture();
	writeFileSync(join(main, "safe-file"), "safe");
	symlinkSync("safe-file", join(main, "inside-link"));
	symlinkSync(dir, join(main, "outside-link"));
	const fifo = Bun.spawnSync(["mkfifo", join(main, "special")]);
	expect(fifo.exitCode).toBe(0);
	writeFileSync(
		join(main, ".worktree-copy"),
		"safe-file\ninside-link\noutside-link\nspecial\n.git\n../outside\n",
	);
	const dry = runCli(main, ["start", "--base-branch", "main", "--dry-run"]);
	expect(dry.code).toBe(0);
	const actual = runCli(main, ["start", "--base-branch", "main"]);
	expect(actual.code).toBe(0);
	const target = createdPath(actual.out);
	for (const entry of [
		"inside-link",
		"outside-link",
		"special",
		".git",
		"../outside",
	]) {
		expect(dry.err).toContain(`本実行で拒否: ${entry}`);
		expect(actual.err).toContain(`コピーをスキップ: ${entry}`);
	}
	for (const entry of ["inside-link", "outside-link", "special"])
		expect(existsSync(join(target, entry))).toBe(false);
	expect(readFileSync(join(target, "safe-file"), "utf8")).toBe("safe");
});

test("session recording failure reports created worktree and branch without rolling back", () => {
	const { main, dir } = fixture();
	const hooks = join(dir, "hooks");
	mkdirSync(hooks);
	const hook = join(hooks, "post-checkout");
	writeFileSync(
		hook,
		'#!/bin/sh\ntouch "$(git rev-parse --absolute-git-dir)/wts-session.json"\n',
	);
	chmodSync(hook, 0o755);
	git(main, "config", "core.hooksPath", hooks);
	const result = runCli(main, ["start", "--base-branch", "main"]);
	expect(result.code).not.toBe(0);
	const target = createdPath(result.out);
	expect(existsSync(target)).toBe(true);
	expect(result.out).toContain("Worktree");
	expect(result.out).toContain("作成済み");
	expect(result.out).toMatch(/セッション記録\s+未作成/);
	expect(git(target, "branch", "--show-current")).not.toBe("main");
});
