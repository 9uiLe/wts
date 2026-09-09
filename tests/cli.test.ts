import { expect, test } from "bun:test";
import { runCli } from "./helpers/cli";
import { version } from "../package.json";

function run(...args: string[]) {
	const { code, out, err } = runCli(process.cwd(), args);
	return { code, out, err };
}

test("help names wts and exposes doctor", () => {
	const result = run("--help");
	expect(result.code).toBe(0);
	expect(result.out).toContain("Usage: wts");
	expect(result.out).toContain("doctor");
});

test("version matches package metadata", () => {
	expect(run("--version")).toEqual({ code: 0, out: `${version}\n`, err: "" });
});

test("unknown commands fail on stderr", () => {
	const result = run("unknown");
	expect(result.code).toBe(1);
	expect(result.err).toContain("unknown command");
	expect(result.out).toBe("");
});

test("doctor reports the runtime without prompting", () => {
	const result = run("doctor");
	expect(result.code).toBe(0);
	expect(result.out).toContain(`platform=${process.platform}`);
	expect(result.out).toContain(`arch=${process.arch}`);
});

test("interactive doctor rejects pipes without hanging", () => {
	const result = run("doctor", "--interactive");
	expect(result.code).toBe(1);
	expect(result.err).toContain("TTY");
});

test("session commands are available through the CLI", () => {
	for (const name of ["start", "cleanup", "stack", "restack"]) {
		const result = run(name, "--help");
		expect(result.code).toBe(0);
		expect(result.out).toMatch(new RegExp(`^Usage: wts ${name}(?:[ |])`));
		expect(result.out).toContain("--dry-run");
	}
});

test("session commands report missing Git while doctor remains standalone", () => {
	for (const name of ["start", "cleanup", "stack", "restack"]) {
		const result = runCli(process.cwd(), [name, "--dry-run"], { PATH: "" });
		expect(result.code).toBe(1);
		expect(result.err).toContain("git コマンドが見つかりません");
	}
	const result = runCli(process.cwd(), ["doctor"], { PATH: "" });
	expect(result.code).toBe(0);
});

test("doctor --check reports missing dependencies without requiring a repository or TTY", () => {
	const result = runCli("/private/tmp", ["doctor", "--check"], { PATH: "" });
	expect(result.code).toBe(1);
	expect(result.out).toContain("brew install git");
	expect(result.out).toContain("brew install gh");
	expect(result.out).toContain("任意");
	expect(result.err).toBe("");
});

test("doctor rejects conflicting interactive and check modes", () => {
	expect(run("doctor", "--interactive", "--check").code).toBe(1);
});

test("help describes boolean environment activation and stack numbering", () => {
	for (const name of ["start", "stack", "cleanup", "discard", "restack"]) {
		const result = run(name, "--help");
		expect(result.out).toContain("DRY_RUN=1");
		expect(result.out).toContain("unset");
	}
	expect(run("restack", "--help").out).toContain("PUSH=1");
	expect(run("restack", "--help").out).toContain("PUSH_ONLY=1");
	expect(run("stack", "--help").out).toContain(
		"GitHub の PR 番号とは異なります",
	);
	expect(run("list", "--help").code).toBe(0);
});
