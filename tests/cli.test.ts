import { expect, test } from "bun:test";
import { version } from "../package.json";

function run(...args: string[]) {
	const result = Bun.spawnSync([process.execPath, "src/cli.ts", ...args]);
	return {
		code: result.exitCode,
		out: result.stdout.toString(),
		err: result.stderr.toString(),
	};
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
