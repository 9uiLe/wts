import { expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const cli = resolve(import.meta.dir, "../src/cli.ts");
const sample = resolve(import.meta.dir, "../docs/examples/name-with-claude.py");

test("config check validates an explicit file without running its script or creating directories", () => {
	const directory = mkdtempSync(join(tmpdir(), "wts-config-cli-"));
	try {
		const marker = join(directory, "executed");
		const script = join(directory, "naming.sh");
		writeFileSync(script, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
		const file = join(directory, ".wts.json");
		writeFileSync(
			file,
			JSON.stringify({
				worktreeDirectory: "sessions",
				naming: { branch: { script } },
			}),
		);
		const run = () =>
			Bun.spawnSync([process.execPath, cli, "config", "check", file], {
				cwd: directory,
			});
		const valid = run();
		expect(valid.exitCode).toBe(0);
		expect(valid.stdout.toString()).toContain("設定 OK");
		expect(existsSync(marker)).toBe(false);
		expect(existsSync(join(directory, "sessions"))).toBe(false);
		writeFileSync(file, JSON.stringify({ worktreeDirecotry: "typo" }));
		const invalid = run();
		expect(invalid.exitCode).toBe(1);
		expect(invalid.stderr.toString()).toContain("worktreeDirecotry");
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("Claude naming example sends the configured prompt and formats branch and worktree names", () => {
	const directory = mkdtempSync(join(tmpdir(), "wts-naming-example-"));
	try {
		const bin = join(directory, "bin");
		mkdirSync(bin);
		const log = join(directory, "claude-args.json");
		writeFileSync(
			join(bin, "claude"),
			`#!${process.execPath}\nawait Bun.write(process.env.CLAUDE_LOG, JSON.stringify(process.argv.slice(2))); console.log(process.env.CLAUDE_RESULT);`,
			{ mode: 0o755 },
		);
		const base = {
			kind: "branch",
			task: "ログインを修正",
			prompt: "英語のスラッグのみ返してください",
			date: "20260908",
		};
		const run = (context: object, output = "fix-login") =>
			Bun.spawnSync(["python3", sample], {
				cwd: directory,
				env: {
					...process.env,
					PATH: `${bin}:${process.env.PATH}`,
					CLAUDE_LOG: log,
					CLAUDE_RESULT: output,
				},
				stdin: Buffer.from(JSON.stringify(context)),
			});
		const start = run(base);
		expect(start.exitCode).toBe(0);
		expect(start.stdout.toString()).toBe("20260908-fix-login\n");
		expect(JSON.parse(readFileSync(log, "utf8"))).toEqual([
			"-p",
			"--model",
			"haiku",
			`${base.prompt}\n\nタスク: ${base.task}`,
		]);
		expect(
			run({ ...base, rootBranch: "root", prNumber: "2" }).stdout.toString(),
		).toBe("fix-login\n");
		expect(run({ ...base, kind: "worktree" }).stdout.toString()).toBe(
			"fix-login\n",
		);
		expect(run(base, "a description instead of a slug").exitCode).toBe(1);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
