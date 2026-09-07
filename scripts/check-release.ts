import { appendFile } from "node:fs/promises";
import { parseReleaseVersion } from "./release-version";

type Release = {
	tag_name: string;
	draft: boolean;
	published_at: string | null;
};

export type GitHubApi = <T>(endpoint: string, paginate?: boolean) => T;

type ReleaseTarget = {
	version: string;
	tag: string;
	commit: string;
};

function createGitHubApi(repository: string): GitHubApi {
	return <T>(endpoint: string, paginate = false): T => {
		const result = Bun.spawnSync(
			[
				"gh",
				"api",
				`repos/${repository}/${endpoint}`,
				...(paginate ? ["--paginate", "--slurp"] : []),
			],
			{ stderr: "inherit" },
		);
		if (result.exitCode !== 0) {
			throw new Error(`GitHub API の取得に失敗しました: ${endpoint}`);
		}
		return JSON.parse(result.stdout.toString()) as T;
	};
}

export function checkRelease(
	input: string,
	head: string,
	api: GitHubApi,
): ReleaseTarget {
	const version = parseReleaseVersion(input);
	const tag = `v${version}`;
	const master = api<{ object: { sha: string } }>("git/ref/heads/master").object
		.sha;
	if (master !== head) {
		throw new Error(
			"master が更新されています。最新 master で再実行してください。",
		);
	}
	const releases = api<Release[][]>("releases", true).flat();
	const latest = releases
		.filter((release) => !release.draft && release.published_at !== null)
		.sort((a, b) =>
			(b.published_at ?? "").localeCompare(a.published_at ?? ""),
		)[0];
	if (latest) {
		// target_commitish は可変のブランチ名の場合があるため、タグの参照先を使う。
		const released = api<{ sha: string }>(
			`commits/${encodeURIComponent(`tags/${latest.tag_name}`)}`,
		).sha;
		if (released === master) {
			throw new Error(
				`最新 master と最新 Release (${latest.tag_name}) のハッシュが一致しています: ${master}`,
			);
		}
	}
	const refs = api<{ ref: string }[]>(
		`git/matching-refs/tags/${encodeURIComponent(tag)}`,
	);
	if (
		refs.some((ref) => ref.ref === `refs/tags/${tag}`) ||
		releases.some((release) => release.tag_name === tag)
	) {
		throw new Error(`バージョン ${tag} は既に使用されています。`);
	}
	return { version, tag, commit: master };
}

if (import.meta.main) {
	const repository = process.env.GITHUB_REPOSITORY;
	const input = process.env.WTS_RELEASE_VERSION;
	if (!repository || !input) {
		throw new Error("GITHUB_REPOSITORY と WTS_RELEASE_VERSION が必要です。");
	}
	const git = Bun.spawnSync(["git", "rev-parse", "HEAD"]);
	if (git.exitCode !== 0) throw new Error("HEAD を取得できません。");
	const result = checkRelease(
		input,
		git.stdout.toString().trim(),
		createGitHubApi(repository),
	);
	if (process.env.GITHUB_OUTPUT) {
		await appendFile(
			process.env.GITHUB_OUTPUT,
			Object.entries(result)
				.map(([key, value]) => `${key}=${value}\n`)
				.join(""),
		);
	}
	console.log(`公開対象: ${result.tag} (${result.commit})`);
}
