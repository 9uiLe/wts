import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { version as packageVersion } from "../package.json";
import { parseReleaseVersion } from "./release-version";

const version =
	process.env.WTS_RELEASE_VERSION === undefined
		? packageVersion
		: parseReleaseVersion(process.env.WTS_RELEASE_VERSION);

const target = "bun-darwin-arm64";
const binaryName = "wts-macos-arm64";
const buildPath = `dist/${binaryName}`;
const releasePath = `release/${binaryName}`;

function runCommand(args: string[]): string {
	const result = Bun.spawnSync(args, { stderr: "inherit" });
	if (result.exitCode !== 0) throw new Error(`Command failed: ${args[0]}`);
	return result.stdout.toString().trim();
}

async function hashFile(path: string): Promise<string> {
	return createHash("sha256")
		.update(await readFile(path))
		.digest("hex");
}

function verifyBinary(): void {
	if (
		resultData(runCommand([`./${buildPath}`, "--format", "json", "--version"]))
			.version !== version
	) {
		throw new Error("Version mismatch");
	}
	if (
		!runCommand([`./${buildPath}`, "--format", "json", "--help"]).includes(
			"Usage: wts",
		)
	) {
		throw new Error("Help mismatch");
	}
	runCommand([`./${buildPath}`, "doctor"]);
	verifyEmbeddedSkill();
}

function resultData(output: string): Record<string, unknown> {
	const response: unknown = JSON.parse(output);
	if (
		typeof response !== "object" ||
		response === null ||
		!("status" in response) ||
		response.status !== "ok" ||
		!("blocks" in response) ||
		!Array.isArray(response.blocks)
	) {
		throw new Error("Invalid hamio response");
	}
	for (const block of response.blocks) {
		if (
			typeof block === "object" &&
			block !== null &&
			block.kind === "result" &&
			block.success === true &&
			typeof block.data === "object" &&
			block.data !== null &&
			!Array.isArray(block.data)
		) {
			return block.data;
		}
	}
	throw new Error("Missing result data");
}

function verifyEmbeddedSkill(): void {
	const directory = mkdtempSync(join(tmpdir(), "wts-build-skills-"));
	const hamioPath = Bun.which("hamio");
	if (!hamioPath) throw new Error("hamio is required for build verification");
	symlinkSync(hamioPath, join(directory, "hamio"));
	function run(...args: string[]): string {
		const result = Bun.spawnSync(
			[resolve(buildPath), "--format", "json", "skills", ...args],
			{
				cwd: directory,
				env: { ...process.env, PATH: directory },
			},
		);
		if (result.exitCode !== 0) throw new Error(result.stderr.toString());
		return result.stdout.toString();
	}
	try {
		const guide = resultData(run("get", "wts-cli"));
		if (
			guide.name !== "wts-cli" ||
			!Array.isArray(guide.lines) ||
			!guide.lines.every((line) => typeof line === "string") ||
			guide.lines.join("\n") !==
				readFileSync("skills/wts-cli/references/guide.md", "utf8")
		) {
			throw new Error("Embedded skill guide mismatch");
		}
		run("install", "wts-cli", "--path", directory);
		if (
			readFileSync(join(directory, "wts-cli/SKILL.md"), "utf8") !==
			readFileSync("skills/wts-cli/SKILL.md", "utf8")
		) {
			throw new Error("Installed skill mismatch");
		}
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

async function writeBuildInfo(): Promise<void> {
	const info = {
		build_kind: "verification_only",
		built_at: new Date().toISOString(),
		version,
		git_commit: runCommand(["git", "rev-parse", "HEAD"]),
		git_worktree: runCommand(["git", "status", "--porcelain"])
			? "dirty"
			: "clean",
		bun_version: Bun.version,
		hamio_version: runCommand(["hamio", "--version"]),
		nix_version: runCommand(["nix", "--version"]),
		system: runCommand(["uname", "-a"]),
		macos_version: runCommand(["sw_vers", "-productVersion"]),
		xcode_cli_tools: runCommand(["xcode-select", "-p"]),
		target,
		minimum_macos_version: "TO_BE_DETERMINED",
		developer_id_signing: "not_performed",
		notarization_status: "not_performed",
		external_file_requirements:
			"Git repository and .wts.json for session commands; optional .worktree-copy; executable naming scripts when configured",
		external_command_requirements:
			"hamio 0.1.0 on PATH for all commands; git (restack: >=2.38); gh authenticated for cleanup; configured naming scripts and their runtime dependencies",
		flake_lock_sha256: await hashFile("flake.lock"),
		bun_lock_sha256: await hashFile("bun.lock"),
	};
	const contents = Object.entries(info)
		.map(([key, value]) => `${key}=${value}\n`)
		.join("");
	await writeFile("release/BUILD_INFO", contents);
}

if (process.platform !== "darwin" || process.arch !== "arm64") {
	throw new Error("ビルドと実行検証には Apple Silicon macOS が必要です。");
}

await mkdir("dist", { recursive: true });
await mkdir("release", { recursive: true });
runCommand([
	process.execPath,
	"build",
	"src/cli.ts",
	"--compile",
	"--define",
	`WTS_BUILD_VERSION=${JSON.stringify(version)}`,
	`--target=${target}`,
	"--outfile",
	buildPath,
]);
verifyBinary();
await copyFile(buildPath, releasePath);
await writeFile(
	`${releasePath}.sha256`,
	`${await hashFile(releasePath)}  ${binaryName}\n`,
);
await writeBuildInfo();
console.log(`検証用ビルド: ${releasePath}`);
