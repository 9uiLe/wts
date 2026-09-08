import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	mkdtemp,
	mkdir,
	writeFile,
	readFile,
	readdir,
	stat,
	symlink,
	rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const installer = new URL("../scripts/web-install.sh", import.meta.url)
	.pathname;
// macOS 標準 Bash 3 でも配布スクリプトを検証する。
const bash =
	process.platform === "darwin" ? "/bin/bash" : (Bun.which("bash") as string);
const binary = "#!/bin/sh\necho 0.1.0-rc.1\n";

async function fixture(
	run: (f: {
		root: string;
		install: (
			args?: string[],
			env?: Record<string, string>,
		) => ReturnType<typeof Bun.spawnSync>;
	}) => Promise<void>,
) {
	const root = await mkdtemp(join(tmpdir(), "wts-web-install-"));
	try {
		for (const name of ["commands", "release", "tmp", "local bin"])
			await mkdir(join(root, name));
		for (const name of [
			"mktemp",
			"rm",
			"cat",
			"shasum",
			"mkdir",
			"chmod",
			"mv",
			"cp",
		])
			await symlink(Bun.which(name) as string, join(root, "commands", name));
		await writeFile(
			join(root, "commands/uname"),
			`#!/bin/sh\ncase "$1" in -s) echo "\${TEST_OS:-Darwin}";; -m) echo "\${TEST_ARCH:-arm64}";; esac\n`,
			{ mode: 0o755 },
		);
		await writeFile(
			join(root, "commands/curl"),
			`#!/bin/sh
printf '%s\\n' "$@" >> "$FIXTURE/curl.log"
while [ "$#" -gt 0 ]; do
  case "$1" in --output) destination="$2"; shift 2;; *) url="$1"; shift;; esac
done
case "$url" in *"$FAIL_DOWNLOAD"*) [ -z "$FAIL_DOWNLOAD" ] || exit 22;; esac
cp "$FIXTURE/release/\${url##*/}" "$destination"
`,
			{ mode: 0o755 },
		);
		await writeFile(join(root, "release/channel.txt"), "v0.1.0-rc.1\n");
		await writeFile(join(root, "release/wts-macos-arm64"), binary);
		await writeFile(
			join(root, "release/wts-macos-arm64.sha256"),
			`${createHash("sha256").update(binary).digest("hex")}  wts-macos-arm64\n`,
		);
		await writeFile(
			join(root, "release/BUILD_INFO"),
			"version=0.1.0-rc.1\ntarget=bun-darwin-arm64\n",
		);
		const script = await readFile(installer);
		const install = (
			args: string[] = ["--install-dir", "local bin"],
			env: Record<string, string> = {},
		) =>
			Bun.spawnSync([bash, "-s", "--", ...args], {
				stdin: script,
				cwd: root,
				env: {
					...process.env,
					PATH: join(root, "commands"),
					HOME: root,
					TMPDIR: join(root, "tmp"),
					FIXTURE: root,
					FAIL_DOWNLOAD: "",
					...env,
				},
			});
		await run({ root, install });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

test("web install downloads the channel and verified release, installs and updates an executable", async () => {
	await fixture(async ({ root, install }) => {
		for (const previous of [undefined, "old binary"]) {
			if (previous) await writeFile(join(root, "local bin/wts"), previous);
			const result = install();
			expect(result.exitCode).toBe(0);
			expect(await readFile(join(root, "local bin/wts"), "utf8")).toBe(binary);
			expect((await stat(join(root, "local bin/wts"))).mode & 0o777).toBe(
				0o755,
			);
			expect(result.stdout?.toString()).toContain(">> ~/.zshrc");
			expect(result.stdout?.toString()).toContain("source ~/.zshrc");
			expect(result.stdout?.toString()).toContain("wts --version");
			expect(result.stdout?.toString()).toContain("doctor --check");
		}
		const log = await readFile(join(root, "curl.log"), "utf8");
		expect(log).toContain("https://9uile.github.io/wts/channel.txt");
		expect(log).toContain(
			"https://github.com/9uiLe/wts/releases/download/v0.1.0-rc.1/wts-macos-arm64",
		);
		expect(log).toContain("--proto\n=https\n--proto-redir\n=https\n");
		expect(await readdir(join(root, "tmp"))).toEqual([]);
		expect(await readdir(join(root, "local bin"))).toEqual(["wts"]);
	});
});

test("explicit version skips channel lookup and defaults to HOME/.local/bin", async () => {
	await fixture(async ({ root, install }) => {
		const result = install(["--version", "0.1.0-rc.1"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout?.toString()).toContain(
			"echo 'export PATH=\"$HOME/.local/bin:$PATH\"' >> ~/.zshrc",
		);
		expect(await readFile(join(root, ".local/bin/wts"), "utf8")).toBe(binary);
		expect(await readFile(join(root, "curl.log"), "utf8")).not.toContain(
			"channel.txt",
		);
	});
});

test("web install skips PATH setup when the installation directory is already on PATH", async () => {
	await fixture(async ({ root, install }) => {
		const result = install(["--install-dir", join(root, "local bin")], {
			PATH: `${join(root, "commands")}:${join(root, "local bin")}`,
		});
		expect(result.exitCode).toBe(0);
		expect(result.stdout?.toString()).not.toContain("~/.zshrc");
		expect(result.stdout?.toString()).toContain("wts --version");
	});
});

for (const directory of [undefined, "tools with spaces", "tools'\\name"]) {
	test(`printed zsh instructions enable wts in the current and subsequent shell (${directory ?? "default directory"})`, async () => {
		await fixture(async ({ root, install }) => {
			const result = install(directory ? ["--install-dir", directory] : []);
			expect(result.exitCode).toBe(0);
			const commands = (result.stdout?.toString() ?? "")
				.split("\n")
				.filter((line) => line.startsWith("  "))
				.join("\n");
			const shell = (input: string) =>
				Bun.spawnSync(["/bin/zsh", "-f"], {
					stdin: Buffer.from(input),
					cwd: root,
					env: {
						...process.env,
						HOME: root,
						ZDOTDIR: root,
						PATH: join(root, "commands"),
					},
				});
			for (const input of [
				`${commands}\nwts --version\n`,
				"source ~/.zshrc\nwts --version\n",
			]) {
				const invocation = shell(input);
				expect(invocation.exitCode).toBe(0);
				expect(invocation.stdout.toString().trim()).toBe("0.1.0-rc.1");
			}
		});
	});
}

for (const failure of [
	"download",
	"checksum",
	"metadata-version",
	"metadata-target",
	"metadata-duplicate",
	"channel",
	"os",
	"arch",
	"placement",
	"missing-command",
]) {
	test(`web install preserves an existing binary and cleans temporary files on ${failure} failure`, async () => {
		await fixture(async ({ root, install }) => {
			await writeFile(join(root, "local bin/wts"), "old binary");
			const env: Record<string, string> = {};
			if (failure === "download") env.FAIL_DOWNLOAD = "wts-macos-arm64";
			if (failure === "checksum")
				await writeFile(join(root, "release/wts-macos-arm64"), "corrupt");
			if (failure === "metadata-version")
				await writeFile(
					join(root, "release/BUILD_INFO"),
					"version=9.0.0\ntarget=bun-darwin-arm64\n",
				);
			if (failure === "metadata-target")
				await writeFile(
					join(root, "release/BUILD_INFO"),
					"version=0.1.0-rc.1\ntarget=bun-linux-x64\n",
				);
			if (failure === "metadata-duplicate")
				await writeFile(
					join(root, "release/BUILD_INFO"),
					"version=0.1.0-rc.1\nversion=0.1.0-rc.1\ntarget=bun-darwin-arm64\n",
				);
			if (failure === "channel")
				await writeFile(
					join(root, "release/channel.txt"),
					"v0.1.0-rc.1\nmalformed\n",
				);
			if (failure === "os") env.TEST_OS = "Linux";
			if (failure === "arch") env.TEST_ARCH = "x86_64";
			if (failure === "missing-command") await rm(join(root, "commands/curl"));
			if (failure === "placement") {
				await rm(join(root, "commands/mv"));
				await writeFile(join(root, "commands/mv"), "#!/bin/sh\nexit 1\n", {
					mode: 0o755,
				});
			}
			expect(install(undefined, env).exitCode).not.toBe(0);
			expect(await readFile(join(root, "local bin/wts"), "utf8")).toBe(
				"old binary",
			);
			expect(await readdir(join(root, "tmp"))).toEqual([]);
			expect(await readdir(join(root, "local bin"))).toEqual(["wts"]);
		});
	});
}

for (const kind of ["symlink", "directory"]) {
	test(`web install rejects a destination ${kind}`, async () => {
		await fixture(async ({ root, install }) => {
			await writeFile(join(root, "original"), "keep");
			if (kind === "symlink")
				await symlink(join(root, "original"), join(root, "local bin/wts"));
			else await mkdir(join(root, "local bin/wts"));
			expect(install().exitCode).not.toBe(0);
			expect(await readFile(join(root, "original"), "utf8")).toBe("keep");
		});
	});
}

test("web install documents options and rejects missing values, unknown arguments and invalid SemVer", async () => {
	await fixture(async ({ root, install }) => {
		const help = install(["--help"]);
		expect(help.exitCode).toBe(0);
		expect(help.stdout?.toString()).toContain("--version");
		for (const args of [
			["--version"],
			["--install-dir"],
			["--unknown"],
			["extra"],
			...["v1.0.0", "01.0.0", "1.0.0-01", "1.0.0/../x", "1.0.0\n"].map((v) => [
				"--version",
				v,
			]),
		])
			expect(install(args).exitCode).not.toBe(0);
		expect(await Bun.file(join(root, "curl.log")).exists()).toBe(false);
	});
});

test("a truncated piped installer cannot start downloading or installing", async () => {
	await fixture(async ({ root }) => {
		const script = await readFile(installer, "utf8");
		const result = Bun.spawnSync([bash], {
			stdin: Buffer.from(script.slice(0, script.lastIndexOf("\n)"))),
			cwd: root,
		});
		expect(result.exitCode).not.toBe(0);
		expect(await readdir(join(root, "tmp"))).toEqual([]);
	});
});
