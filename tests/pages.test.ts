import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { preparePages, type PublishedRelease } from "../scripts/prepare-pages";

const temporary: string[] = [];
afterEach(async () => {
	await Promise.all(
		temporary
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

function release(): PublishedRelease {
	return {
		tag_name: "v0.1.0-rc.1",
		draft: false,
		published_at: "2026-09-08T00:00:00Z",
		assets: ["wts-macos-arm64", "wts-macos-arm64.sha256", "BUILD_INFO"].map(
			(name) => ({
				name,
				state: "uploaded",
				browser_download_url: `https://github.com/9uiLe/wts/releases/download/v0.1.0-rc.1/${name}`,
			}),
		),
	};
}

async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), "wts-pages-"));
	temporary.push(directory);
	const installer = join(directory, "source.sh");
	await writeFile(installer, "#!/bin/bash\necho installer\n");
	return { installer, output: join(directory, "site") };
}

test("公開済み Pre-release を選択してインストーラーとタグを一組で生成する", async () => {
	const { installer, output } = await fixture();
	await preparePages("0.1.0-rc.1", release(), installer, output);
	expect(await readFile(join(output, "install.sh"), "utf8")).toBe(
		await readFile(installer, "utf8"),
	);
	expect(await readFile(join(output, "channel.txt"), "utf8")).toBe(
		"v0.1.0-rc.1\n",
	);
});

test("未公開・別バージョン・不足・未完了・別配布先の成果物では配布先情報を変更しない", async () => {
	const { installer, output } = await fixture();
	await preparePages("0.1.0-rc.1", release(), installer, output);
	const invalid: PublishedRelease[] = [
		{ ...release(), draft: true },
		{ ...release(), published_at: null },
		{ ...release(), tag_name: "v0.2.0" },
		{ ...release(), assets: release().assets.slice(1) },
		{
			...release(),
			assets: release().assets.map((a) => ({ ...a, state: "new" })),
		},
		{
			...release(),
			assets: release().assets.map((a) => ({
				...a,
				browser_download_url: a.browser_download_url.replace(
					"v0.1.0-rc.1",
					"v0.2.0",
				),
			})),
		},
	];
	for (const candidate of invalid) {
		await expect(
			preparePages("0.1.0-rc.1", candidate, installer, output),
		).rejects.toThrow();
		expect(await readFile(join(output, "channel.txt"), "utf8")).toBe(
			"v0.1.0-rc.1\n",
		);
	}
});

test("パスやシェル構文を含むバージョンを配信しない", async () => {
	const { installer, output } = await fixture();
	await expect(
		preparePages("../main;echo unexpected", release(), installer, output),
	).rejects.toThrow("SemVer");
});
