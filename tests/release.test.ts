import { expect, test } from "bun:test";
import { checkRelease, type GitHubApi } from "../scripts/check-release";

const head = "a".repeat(40);
const older = "b".repeat(40);
const release = {
	tag_name: "v0.1.0",
	draft: false,
	published_at: "2026-09-01T00:00:00Z",
};

function fixture(overrides: Record<string, unknown> = {}): GitHubApi {
	const responses: Record<string, unknown> = {
		"git/ref/heads/master": { object: { sha: head } },
		releases: [[release]],
		"commits/tags%2Fv0.1.0": { sha: older },
		"git/matching-refs/tags/v0.2.0": [],
		...overrides,
	};
	return (endpoint: string): unknown => {
		if (!(endpoint in responses))
			throw new Error(`Unexpected API: ${endpoint}`);
		return responses[endpoint];
	};
}

test("初回公開は Release がなくても許可する", () => {
	expect(checkRelease("0.2.0", head, fixture({ releases: [[]] }))).toEqual({
		version: "0.2.0",
		tag: "v0.2.0",
		commit: head,
	});
});

test("最新 Release と master のコミットが異なる場合は公開を許可する", () => {
	expect(checkRelease("0.2.0", head, fixture()).commit).toBe(head);
});

test("バージョンが異なっても最新 Release と master が同じコミットなら失敗する", () => {
	expect(() =>
		checkRelease(
			"0.2.0",
			head,
			fixture({ "commits/tags%2Fv0.1.0": { sha: head } }),
		),
	).toThrow("ハッシュが一致");
});

test("全ページから公開日時が最新の Pre-release を選び下書きを除く", () => {
	expect(() =>
		checkRelease(
			"0.2.0",
			head,
			fixture({
				releases: [
					[{ ...release, draft: true, published_at: "2026-09-05T00:00:00Z" }],
					[release],
					[
						{
							...release,
							tag_name: "v0.1.1-rc.1",
							prerelease: true,
							published_at: "2026-09-04T00:00:00Z",
						},
					],
				],
				"commits/tags%2Fv0.1.1-rc.1": { sha: head },
			}),
		),
	).toThrow("v0.1.1-rc.1");
});

test("ビルド対象と最新 master が異なると失敗する", () => {
	expect(() => checkRelease("0.2.0", older, fixture())).toThrow(
		"master が更新",
	);
});

test("既存タグと既存下書きのバージョンを再利用しない", () => {
	for (const overrides of [
		{ "git/matching-refs/tags/v0.2.0": [{ ref: "refs/tags/v0.2.0" }] },
		{ releases: [[{ ...release, tag_name: "v0.2.0", draft: true }]] },
	]) {
		expect(() => checkRelease("0.2.0", head, fixture(overrides))).toThrow(
			"既に使用",
		);
	}
});

test("同じ接頭辞の別タグは入力バージョンの衝突として扱わない", () => {
	expect(
		checkRelease(
			"0.2.0",
			head,
			fixture({
				"git/matching-refs/tags/v0.2.0": [{ ref: "refs/tags/v0.2.0-rc.1" }],
			}),
		).tag,
	).toBe("v0.2.0");
});

test("API 失敗や参照できないタグを初回公開として扱わない", () => {
	const api: GitHubApi = () => {
		throw new Error("API unavailable");
	};
	expect(() => checkRelease("0.2.0", head, api)).toThrow("API unavailable");
	expect(() =>
		checkRelease(
			"0.2.0",
			head,
			fixture({
				releases: [[{ ...release, tag_name: "missing" }]],
			}),
		),
	).toThrow("Unexpected API");
});

for (const [endpoint, values] of Object.entries({
	"git/ref/heads/master": [
		null,
		[],
		{},
		{ object: null },
		{ object: { sha: 1 } },
	],
	releases: [
		null,
		{},
		[null],
		[release],
		[[null]],
		[[{ ...release, draft: "false" }]],
		[[{ ...release, published_at: 1 }]],
		[[{ ...release, tag_name: null }]],
	],
	"commits/tags%2Fv0.1.0": [null, [], {}, { sha: 1 }],
	"git/matching-refs/tags/v0.2.0": [null, {}, [null], [{ ref: 1 }]],
})) {
	test(`不正な API 応答を明示的に拒否する: ${endpoint}`, () => {
		for (const value of values) {
			expect(() =>
				checkRelease("0.2.0", head, fixture({ [endpoint]: value })),
			).toThrow(`GitHub API の応答形式が不正です: ${endpoint}`);
		}
	});
}
