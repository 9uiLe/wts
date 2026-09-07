import { afterEach, expect, test } from "bun:test";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoadedConfig } from "../src/config";
import {
	defaultNaming,
	generateName,
	validateBranchName,
	validateWorktreeName,
} from "../src/naming";
import { Git } from "../src/session";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});
function fixture(code: string, prompt?: string): LoadedConfig {
	const directory = realpathSync(mkdtempSync(join(tmpdir(), "wts-naming-")));
	dirs.push(directory);
	const script = join(directory, "name script");
	writeFileSync(script, `#!${process.execPath}\n${code}`);
	chmodSync(script, 0o755);
	return {
		config: {
			naming: {
				branch: { script, ...(prompt === undefined ? {} : { prompt }) },
			},
		},
		directory,
		path: join(directory, ".wts.json"),
		worktreesBase: join(directory, "worktrees"),
	};
}

test("default naming combines JST date and independent UUIDs", () => {
	const a = defaultNaming();
	const b = defaultNaming();
	expect(a.defaultName).toMatch(
		/^\d{8}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
	);
	expect(a.uuid).not.toBe(b.uuid);
	const expected = new Intl.DateTimeFormat("sv-SE", {
		timeZone: "Asia/Tokyo",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	})
		.format(new Date())
		.replaceAll("-", "");
	expect(a.date).toBe(expected);
});

test("configured script receives exact JSON task and prompt in config directory", () => {
	const config = fixture(
		'const input = await Bun.stdin.json(); await Bun.write("received.json", JSON.stringify(input)); console.log("feature/custom");',
		"命名の指示",
	);
	const context = {
		...defaultNaming(),
		kind: "branch" as const,
		task: "$(touch should-not-exist); タスク",
		rootBranch: "root",
		prNumber: "2",
	};
	expect(generateName(config, context)).toBe("feature/custom");
	expect(
		JSON.parse(readFileSync(join(config.directory, "received.json"), "utf8")),
	).toEqual({ ...context, prompt: "命名の指示" });
	const rule = config.config.naming?.branch;
	if (!rule) throw new Error("fixture missing naming rule");
	delete rule.prompt;
	expect(generateName(config, context)).toBe("feature/custom");
	expect(
		JSON.parse(readFileSync(join(config.directory, "received.json"), "utf8"))
			.prompt,
	).toBe("");
});

test("missing naming configuration returns default without running a script", () => {
	const config = fixture('throw new Error("must not run")');
	config.config = {};
	const context = {
		...defaultNaming(),
		kind: "branch" as const,
		task: "request AI",
	};
	expect(generateName(config, context)).toBe(context.defaultName);
});

for (const [name, code] of [
	["empty", 'console.log("")'],
	["multiple lines", 'console.log("one\\ntwo")'],
	["extra blank line", 'console.log("one\\n")'],
	["failure", 'console.error("private diagnostics"); process.exit(2)'],
] as const) {
	test(`script ${name} is rejected without exposing stderr`, () => {
		const config = fixture(code);
		expect(() =>
			generateName(config, { ...defaultNaming(), kind: "branch", task: "" }),
		).toThrow(/命名スクリプト/);
	});
}

test("worktree names must be a single component and branch names follow Git rules", () => {
	for (const name of [
		"",
		".",
		"..",
		".git",
		".GIT",
		"a/b",
		"a\\b",
		"a\0b",
		"a\nb",
	])
		expect(() => validateWorktreeName(name)).toThrow();
	expect(() => validateWorktreeName("日本語 session")).not.toThrow();
	const config = fixture("");
	const dir = join(config.directory, "repo");
	mkdirSync(dir);
	const git = new Git(dir);
	git.run(["init", "-b", "main"]);
	for (const name of ["", "--help", "@{-1}", "a..b", "a b"])
		expect(() => validateBranchName(git, name)).toThrow();
	expect(() => validateBranchName(git, "feature/valid-name")).not.toThrow();
});
