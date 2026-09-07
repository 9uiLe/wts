import { createHash } from "node:crypto";
import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import { version } from "../package.json";

function run(args: string[]): string {
  const result = Bun.spawnSync(args, { stderr: "inherit" });
  if (result.exitCode !== 0) throw new Error(`Command failed: ${args[0]}`);
  return result.stdout.toString().trim();
}

if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("ビルドと実行検証には Apple Silicon macOS が必要です。");
}

await mkdir("dist", { recursive: true });
await mkdir("release", { recursive: true });
const binary = "wts-macos-arm64";
run([process.execPath, "build", "src/cli.ts", "--compile", "--target=bun-darwin-arm64", "--outfile", `dist/${binary}`]);
if (run([`./dist/${binary}`, "--version"]) !== version) throw new Error("Version mismatch");
if (!run([`./dist/${binary}`, "--help"]).includes("Usage: wts")) throw new Error("Help mismatch");
run([`./dist/${binary}`, "doctor"]);
await copyFile(`dist/${binary}`, `release/${binary}`);
const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
await writeFile(`release/${binary}.sha256`, `${sha256(await readFile(`release/${binary}`))}  ${binary}\n`);
const info = {
  build_kind: "verification_only",
  built_at: new Date().toISOString(),
  version,
  git_commit: run(["git", "rev-parse", "HEAD"]),
  git_worktree: run(["git", "status", "--porcelain"]) ? "dirty" : "clean",
  bun_version: Bun.version,
  nix_version: run(["nix", "--version"]),
  system: run(["uname", "-a"]),
  macos_version: run(["sw_vers", "-productVersion"]),
  xcode_cli_tools: run(["xcode-select", "-p"]),
  target: "bun-darwin-arm64",
  minimum_macos_version: "TO_BE_DETERMINED",
  developer_id_signing: "not_performed",
  notarization_status: "not_performed",
  external_file_requirements: "none",
  external_command_requirements: "none",
  flake_lock_sha256: sha256(await readFile("flake.lock")),
  bun_lock_sha256: sha256(await readFile("bun.lock")),
};
await writeFile("release/BUILD_INFO", Object.entries(info).map(([key, value]) => `${key}=${value}\n`).join(""));
console.log(`検証用ビルド: release/${binary}`);
