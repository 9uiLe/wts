import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	mkdtemp,
	mkdir,
	writeFile,
	readFile,
	stat,
	readdir,
	lstat,
	symlink,
	rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const bash = Bun.which("bash") as string;
const installer = new URL("../scripts/install.sh", import.meta.url).pathname;

async function withArtifacts(run: (directory: string) => Promise<void>) {
	const directory = await mkdtemp(join(tmpdir(), "wts-install-"));
	const artifacts = join(directory, "release files");
	const binary = "#!/bin/sh\necho wts\n";
	try {
		await mkdir(artifacts);
		const commands = join(directory, "commands");
		await mkdir(commands);
		for (const name of [
			"dirname",
			"shasum",
			"cat",
			"mkdir",
			"install",
			"mktemp",
			"rm",
			"mv",
		]) {
			await symlink(Bun.which(name) as string, join(commands, name));
		}
		await writeFile(
			join(commands, "uname"),
			'#!/bin/sh\ncase "$1" in -s) echo Darwin;; -m) echo arm64;; esac\n',
			{ mode: 0o755 },
		);
		await writeFile(
			join(commands, "brew"),
			'#!/bin/sh\nprintf "%s\\n" "$@" > "$BREW_LOG"\nexit "$BREW_EXIT"\n',
			{ mode: 0o755 },
		);
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

function install(directory: string, withDeps = false, brewExit = "0") {
	return Bun.spawnSync(
		[
			bash,
			installer,
			...(withDeps ? ["--with-deps"] : []),
			"release files",
			"local bin",
		],
		{
			cwd: directory,
			env: {
				...process.env,
				PATH: join(directory, "commands"),
				BREW_LOG: join(directory, "brew.log"),
				BREW_EXIT: brewExit,
			},
		},
	);
}

test("install accepts relative paths with spaces and installs an executable", async () => {
	await withArtifacts(async (directory) => {
		expect(install(directory).exitCode).toBe(0);
		expect(await Bun.file(join(directory, "brew.log")).exists()).toBe(false);
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

test("with-deps installs Git and gh with fixed arguments before placing wts", async () => {
	await withArtifacts(async (directory) => {
		const result = install(directory, true);
		expect(result.exitCode).toBe(0);
		expect(await readFile(join(directory, "brew.log"), "utf8")).toBe(
			"install\ngit\ngh\n",
		);
		expect(await Bun.file(join(directory, "local bin/wts")).exists()).toBe(
			true,
		);
		expect(result.stdout.toString()).toContain("gh auth login");
		expect(result.stdout.toString()).toContain("doctor --check");
	});
});

test("failed Homebrew leaves existing wts unchanged and creates no new installation", async () => {
	await withArtifacts(async (directory) => {
		expect(install(directory, true, "1").exitCode).toBe(1);
		expect(await Bun.file(join(directory, "local bin/wts")).exists()).toBe(
			false,
		);
		await mkdir(join(directory, "local bin"));
		await writeFile(join(directory, "local bin/wts"), "installed version");
		expect(install(directory, true, "1").exitCode).toBe(1);
		expect(await readFile(join(directory, "local bin/wts"), "utf8")).toBe(
			"installed version",
		);
	});
});

test("missing Homebrew fails without replacing an existing installation", async () => {
	await withArtifacts(async (directory) => {
		await rm(join(directory, "commands/brew"));
		await mkdir(join(directory, "local bin"));
		await writeFile(join(directory, "local bin/wts"), "installed version");
		const result = install(directory, true);
		expect(result.exitCode).toBe(1);
		expect(result.stderr.toString()).toContain("Homebrew が見つかりません");
		expect(await readFile(join(directory, "local bin/wts"), "utf8")).toBe(
			"installed version",
		);
	});
});

test("with-deps validates checksums before invoking Homebrew", async () => {
	await withArtifacts(async (directory) => {
		await writeFile(
			join(directory, "release files/wts-macos-arm64"),
			"corrupted",
		);
		expect(install(directory, true).exitCode).toBe(1);
		expect(await Bun.file(join(directory, "brew.log")).exists()).toBe(false);
		expect(await Bun.file(join(directory, "local bin/wts")).exists()).toBe(
			false,
		);
	});
});

test("installer explains options and rejects unknown options", () => {
	const help = Bun.spawnSync([bash, installer, "--help"]);
	expect(help.exitCode).toBe(0);
	expect(help.stdout.toString()).toContain("--with-deps");
	const unknown = Bun.spawnSync([bash, installer, "--unknown"]);
	expect(unknown.exitCode).toBe(1);
	expect(unknown.stderr.toString()).toContain("不明なオプション");
});

for (const kind of ["symlink", "dangling-symlink", "directory", "fifo"]) {
	test(`install rejects a destination ${kind} without modifying it`, async () => {
		await withArtifacts(async (directory) => {
			await mkdir(join(directory, "local bin"));
			const destination = join(directory, "local bin/wts");
			const original = join(directory, "original");
			await writeFile(original, "keep");
			if (kind === "symlink" || kind === "dangling-symlink")
				await symlink(
					kind === "symlink" ? original : join(directory, "missing"),
					destination,
				);
			else if (kind === "directory") await mkdir(destination);
			else expect(Bun.spawnSync(["mkfifo", destination]).exitCode).toBe(0);
			const before = await lstat(destination);
			expect(install(directory).exitCode).not.toBe(0);
			expect((await lstat(destination)).ino).toBe(before.ino);
			expect(await readFile(original, "utf8")).toBe("keep");
			expect(await readdir(join(directory, "local bin"))).toEqual(["wts"]);
		});
	});
}

for (const command of ["install", "mv"]) {
	test(`failed ${command} keeps the installed binary and removes staging`, async () => {
		await withArtifacts(async (directory) => {
			await mkdir(join(directory, "local bin"));
			await writeFile(join(directory, "local bin/wts"), "keep");
			await rm(join(directory, "commands", command));
			await writeFile(
				join(directory, "commands", command),
				"#!/bin/sh\nexit 1\n",
				{ mode: 0o755 },
			);
			expect(install(directory).exitCode).not.toBe(0);
			expect(await readFile(join(directory, "local bin/wts"), "utf8")).toBe(
				"keep",
			);
			expect(await readdir(join(directory, "local bin"))).toEqual(["wts"]);
		});
	});
}

test("install replaces a regular file without changing other hard links", async () => {
	await withArtifacts(async (directory) => {
		await mkdir(join(directory, "local bin"));
		await writeFile(join(directory, "original"), "keep");
		expect(
			Bun.spawnSync([
				"ln",
				join(directory, "original"),
				join(directory, "local bin/wts"),
			]).exitCode,
		).toBe(0);
		expect(install(directory).exitCode).toBe(0);
		expect(await readFile(join(directory, "original"), "utf8")).toBe("keep");
		expect(await readFile(join(directory, "local bin/wts"), "utf8")).not.toBe(
			"keep",
		);
	});
});
