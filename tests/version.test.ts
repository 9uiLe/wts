import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseReleaseVersion } from "../scripts/release-version";

test.each(["1.2.3", "0.0.0", "2.0.0-rc.1", "1.2.3+build.01"])(
	"release builds accept SemVer %s",
	(value) => {
		expect(parseReleaseVersion(value)).toBe(value);
	},
);

test.each(["", "v1.2.3", "1.2", "01.2.3", "1.2.3-01", "1.2.3\n"])(
	"release builds reject invalid version %j",
	(value) => {
		expect(() => parseReleaseVersion(value)).toThrow("SemVer");
	},
);

test("compiled CLI retains the build version regardless of runtime environment", async () => {
	const directory = await mkdtemp(join(tmpdir(), "wts-version-"));
	try {
		const binary = join(directory, "wts");
		const build = Bun.spawnSync([
			process.execPath,
			"build",
			"src/cli.ts",
			"--compile",
			"--define",
			`WTS_BUILD_VERSION=${JSON.stringify("1.2.3-rc.1")}`,
			"--outfile",
			binary,
		]);
		expect(build.exitCode).toBe(0);
		const result = Bun.spawnSync([binary, "--version"], {
			env: { ...process.env, WTS_RELEASE_VERSION: "9.9.9" },
		});
		expect(result.exitCode).toBe(0);
		expect(result.stdout.toString()).toBe("1.2.3-rc.1\n");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
