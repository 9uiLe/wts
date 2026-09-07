import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const doctor = resolve(import.meta.dir, "../src/doctor.ts");

function check({
	git = "2.38.0",
	gh = true,
	auth = true,
	claude = true,
	platform = "darwin",
	arch = "arm64",
}: {
	git?: string | null;
	gh?: boolean;
	auth?: boolean;
	claude?: boolean;
	platform?: string;
	arch?: string;
} = {}) {
	const cwd = mkdtempSync(join(tmpdir(), "wts-doctor-"));
	try {
		if (git !== null)
			writeFileSync(
				join(cwd, "git"),
				`#!/bin/sh\necho 'git version ${git}'\n`,
				{
					mode: 0o755,
				},
			);
		if (gh)
			writeFileSync(
				join(cwd, "gh"),
				`#!/bin/sh\nif [ "$1" = "--version" ]; then exit 0; fi\necho private-auth-output\necho private-auth-error >&2\nexit ${auth ? 0 : 1}\n`,
				{ mode: 0o755 },
			);
		if (claude)
			writeFileSync(join(cwd, "claude"), "#!/bin/sh\nexit 0\n", {
				mode: 0o755,
			});
		const result = Bun.spawnSync(
			[
				process.execPath,
				"--eval",
				`import { checkEnvironment } from ${JSON.stringify(doctor)}; await checkEnvironment(${JSON.stringify({ platform, arch })});`,
			],
			{ cwd, env: { ...process.env, PATH: cwd } },
		);
		return {
			code: result.exitCode,
			out: result.stdout.toString(),
			err: result.stderr.toString(),
		};
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
}

test("environment check succeeds outside a repository with supported dependencies", () => {
	const result = check();
	expect(result.code).toBe(0);
	expect(result.out).toContain("OK: Git 2.38");
	expect(result.out).toContain("OK: GitHub CLI 認証");
	expect(result.out).toContain("OK: Claude CLI");
	expect(result.out).not.toContain("private-auth");
	expect(result.err).toBe("");
});

test("missing required dependencies report installation steps and fail", () => {
	const result = check({ git: null, gh: false, claude: false });
	expect(result.code).toBe(1);
	expect(result.out).toContain("brew install git");
	expect(result.out).toContain("brew install gh");
});

test("Git older than the restack requirement fails", () => {
	expect(check({ git: "2.37.9" }).code).toBe(1);
	expect(check({ git: "3.0.0" }).code).toBe(0);
});

test("authentication failure gives guidance without exposing auth output", () => {
	const result = check({ auth: false });
	expect(result.code).toBe(1);
	expect(result.out).toContain("gh auth login");
	expect(result.out).not.toContain("private-auth");
	expect(result.err).toBe("");
});

test("missing optional Claude CLI keeps the check successful", () => {
	const result = check({ claude: false });
	expect(result.code).toBe(0);
	expect(result.out).toContain("日時によるブランチ命名");
});

test("unsupported operating system or architecture fails", () => {
	expect(check({ platform: "linux" }).code).toBe(1);
	expect(check({ arch: "x64" }).code).toBe(1);
});
