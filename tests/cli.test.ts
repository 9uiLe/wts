import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { linkHamio, runCli } from "./helpers/cli";
import { version } from "../package.json";

function run(...args: string[]) {
	return runCli(process.cwd(), args);
}

function withoutGit(action: (path: string) => void) {
	const path = mkdtempSync(join(tmpdir(), "wts-hamio-only-"));
	try {
		linkHamio(path);
		action(path);
	} finally {
		rmSync(path, { recursive: true, force: true });
	}
}

test("help names wts and exposes doctor", () => {
	const result = run("--help");
	expect(result.code).toBe(0);
	expect(result.text).toContain("Usage: wts");
	expect(result.text).toContain("doctor");
});

test("version matches package metadata", () => {
	const result = run("--version");
	expect(result.code).toBe(0);
	expect(JSON.parse(result.out)).toEqual({
		apiVersion: 1,
		status: "ok",
		blocks: [{ kind: "result", success: true, data: { version } }],
	});
	expect(result.err).toBe("");
});

test("unknown commands fail with a machine-readable error", () => {
	const result = run("unknown");
	expect(result.code).toBe(1);
	expect(result.text).toContain("unknown command");
	expect(result.err).toBe("");
});

test("doctor reports the runtime without prompting", () => {
	const result = run("doctor");
	expect(result.code).toBe(0);
	expect(result.text).toContain(`platform=${process.platform}`);
	expect(result.text).toContain(`arch=${process.arch}`);
});

test("interactive doctor rejects pipes without hanging", () => {
	const result = run("doctor", "--interactive");
	expect(result.code).toBe(1);
	expect(result.text).toContain("TTY");
});

test("session commands are available through the CLI", () => {
	for (const name of ["start", "cleanup", "stack", "restack"]) {
		const result = run(name, "--help");
		expect(result.code).toBe(0);
		expect(result.text).toMatch(new RegExp(`^Usage: wts ${name}(?:[ |])`));
		expect(result.text).toContain("--dry-run");
	}
});

test("session commands report missing Git while doctor needs only hamio", () => {
	withoutGit((path) => {
		for (const name of ["start", "cleanup", "stack", "restack"]) {
			const result = runCli(process.cwd(), [name, "--dry-run"], { PATH: path });
			expect(result.code).toBe(1);
			expect(result.text).toContain("git コマンドが見つかりません");
		}
		const result = runCli(process.cwd(), ["doctor"], { PATH: path });
		expect(result.code).toBe(0);
	});
});

test("doctor --check reports missing dependencies without requiring a repository or TTY", () => {
	withoutGit((path) => {
		const result = runCli("/private/tmp", ["doctor", "--check"], {
			PATH: path,
		});
		expect(result.code).toBe(1);
		expect(result.text).toContain("brew install git");
		expect(result.text).toContain("brew install gh");
		expect(result.text).toContain("任意");
		expect(result.err).toBe("");
	});
});

test("doctor rejects conflicting interactive and check modes", () => {
	expect(run("doctor", "--interactive", "--check").code).toBe(1);
});

test("help describes boolean environment activation and stack numbering", () => {
	for (const name of ["start", "stack", "cleanup", "discard", "restack"]) {
		const result = run(name, "--help");
		expect(result.text).toContain("DRY_RUN=1");
		expect(result.text).toContain("unset");
	}
	expect(run("restack", "--help").text).toContain("PUSH=1");
	expect(run("restack", "--help").text).toContain("PUSH_ONLY=1");
	expect(run("stack", "--help").text).toContain(
		"GitHub の PR 番号とは異なります",
	);
	expect(run("list", "--help").code).toBe(0);
});
