import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseReleaseVersion } from "./release-version";

export type PublishedRelease = {
	tag_name: string;
	draft: boolean;
	published_at: string | null;
	assets: { name: string; state: string; browser_download_url: string }[];
};

export async function preparePages(
	version: string,
	release: PublishedRelease,
	installer: string,
	output: string,
): Promise<void> {
	const tag = `v${parseReleaseVersion(version)}`;
	if (release.tag_name !== tag || release.draft || !release.published_at) {
		throw new Error("指定バージョンの公開済み Release が必要です。");
	}
	for (const name of [
		"wts-macos-arm64",
		"wts-macos-arm64.sha256",
		"BUILD_INFO",
	]) {
		const assets = release.assets.filter((asset) => asset.name === name);
		if (
			assets.length !== 1 ||
			assets[0]?.state !== "uploaded" ||
			assets[0]?.browser_download_url !==
				`https://github.com/9uiLe/wts/releases/download/${tag}/${name}`
		) {
			throw new Error(
				`同一 Release のアップロード済み成果物が必要です: ${name}`,
			);
		}
	}
	await mkdir(output, { recursive: true });
	await copyFile(installer, join(output, "install.sh"));
	await writeFile(join(output, "channel.txt"), `${tag}\n`);
	await writeFile(join(output, ".nojekyll"), "");
}

if (import.meta.main) {
	const version = parseReleaseVersion(process.env.WTS_RELEASE_VERSION ?? "");
	const result = Bun.spawnSync(
		[
			"gh",
			"api",
			`repos/9uiLe/wts/releases/tags/${encodeURIComponent(`v${version}`)}`,
		],
		{ stderr: "inherit" },
	);
	if (result.exitCode !== 0)
		throw new Error("公開済み Release を取得できません。");
	await preparePages(
		version,
		JSON.parse(result.stdout.toString()),
		"scripts/web-install.sh",
		"release/pages",
	);
}
