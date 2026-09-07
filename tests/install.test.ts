import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	mkdtemp,
	mkdir,
	writeFile,
	readFile,
	stat,
	rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const installer = new URL("../scripts/install.sh", import.meta.url).pathname;

async function withArtifacts(run: (directory: string) => Promise<void>) {
	const directory = await mkdtemp(join(tmpdir(), "wts-install-"));
	const artifacts = join(directory, "release files");
	const binary = "#!/bin/sh\necho wts\n";
	try {
		await mkdir(artifacts);
		await writeFile(join(artifacts, "wts-macos-arm64"), binary);
		await writeFile(
			join(artifacts, "BUILD_INFO"),
			"build_kind=verification_only\n",
		);
		await writeFile(
			join(artifacts, "wts-macos-arm64.sha256"),
			`${createHash("sha256").update(binary).digest("hex")}  wts-macos-arm64\n`,
		);
		await run(directory);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

function install(directory: string) {
	return Bun.spawnSync(["bash", installer, "release files", "local bin"], {
		cwd: directory,
	});
}

test("install accepts relative paths with spaces and installs an executable", async () => {
	await withArtifacts(async (directory) => {
		expect(install(directory).exitCode).toBe(0);
		const installed = join(directory, "local bin/wts");
		expect(await readFile(installed, "utf8")).toBe(
			await readFile(join(directory, "release files/wts-macos-arm64"), "utf8"),
		);
		expect((await stat(installed)).mode & 0o777).toBe(0o755);
	});
});

test("install rejects a checksum mismatch without replacing the installed binary", async () => {
	await withArtifacts(async (directory) => {
		await mkdir(join(directory, "local bin"));
		await writeFile(join(directory, "local bin/wts"), "installed version");
		await writeFile(
			join(directory, "release files/wts-macos-arm64"),
			"corrupted",
		);
		const result = install(directory);
		expect(result.exitCode).toBe(1);
		expect(result.stderr.toString()).toContain("SHA-256");
		expect(await readFile(join(directory, "local bin/wts"), "utf8")).toBe(
			"installed version",
		);
	});
});

test("install requires BUILD_INFO before creating the destination", async () => {
	await withArtifacts(async (directory) => {
		await rm(join(directory, "release files/BUILD_INFO"));
		const result = install(directory);
		expect(result.exitCode).toBe(1);
		expect(result.stderr.toString()).toContain("BUILD_INFO");
		expect(await Bun.file(join(directory, "local bin/wts")).exists()).toBe(
			false,
		);
	});
});
