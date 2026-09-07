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

test("session commands are available through the CLI", () => {
	for (const name of ["start", "cleanup", "stack", "restack"]) {
		const result = run(name, "--help");
		expect(result.code).toBe(0);
		expect(result.out).toMatch(new RegExp(`^Usage: wts ${name}(?:[ |])`));
		expect(result.out).toContain("--dry-run");
	}
});

test("session commands report missing Git while doctor remains standalone", () => {
	const cli = `${process.cwd()}/src/cli.ts`;
	for (const name of ["start", "cleanup", "stack", "restack"]) {
		const result = Bun.spawnSync([process.execPath, cli, name, "--dry-run"], {
			env: { ...process.env, PATH: "" },
		});
		expect(result.exitCode).toBe(1);
		expect(result.stderr.toString()).toContain("git コマンドが見つかりません");
	}
	const result = Bun.spawnSync([process.execPath, cli, "doctor"], {
		env: { ...process.env, PATH: "" },
	});
	expect(result.exitCode).toBe(0);
});

test("doctor --check reports missing dependencies without requiring a repository or TTY", () => {
	const cli = `${process.cwd()}/src/cli.ts`;
	const result = Bun.spawnSync([process.execPath, cli, "doctor", "--check"], {
		cwd: "/private/tmp",
		env: { ...process.env, PATH: "" },
	});
	expect(result.exitCode).toBe(1);
	expect(result.stdout.toString()).toContain("brew install git");
	expect(result.stdout.toString()).toContain("brew install gh");
	expect(result.stdout.toString()).toContain("任意");
	expect(result.stderr.toString()).toBe("");
});

test("doctor rejects conflicting interactive and check modes", () => {
	expect(run("doctor", "--interactive", "--check").code).toBe(1);
});
