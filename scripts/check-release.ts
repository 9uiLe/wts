import { appendFile } from "node:fs/promises";
import { parseReleaseVersion } from "./release-version";

type Release = {
	tag_name: string;
	draft: boolean;
	published_at: string | null;
};

export type GitHubApi = (endpoint: string, paginate?: boolean) => unknown;

type ReleaseTarget = {
	version: string;
	tag: string;
	commit: string;
};

function createGitHubApi(repository: string): GitHubApi {
	return (endpoint: string, paginate = false): unknown => {
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
		return JSON.parse(result.stdout.toString());
	};
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidResponse(endpoint: string): never {
	throw new Error(`GitHub API の応答形式が不正です: ${endpoint}`);
}

function sha(value: unknown, endpoint: string): string {
	if (!record(value) || typeof value.sha !== "string")
		return invalidResponse(endpoint);
	return value.sha;
}

function releasePages(value: unknown): Release[] {
	if (!Array.isArray(value)) return invalidResponse("releases");
	const releases: Release[] = [];
	for (const page of value) {
		if (!Array.isArray(page)) return invalidResponse("releases");
		for (const release of page) {
			if (
				!record(release) ||
				typeof release.tag_name !== "string" ||
				typeof release.draft !== "boolean" ||
				(release.published_at !== null &&
					typeof release.published_at !== "string")
			)
				return invalidResponse("releases");
			releases.push({
				tag_name: release.tag_name,
				draft: release.draft,
				published_at: release.published_at,
			});
		}
	}
	return releases;
}

function tagRefs(value: unknown, endpoint: string): string[] {
	if (!Array.isArray(value)) return invalidResponse(endpoint);
	return value.map((ref: unknown) => {
		if (!record(ref) || typeof ref.ref !== "string")
			return invalidResponse(endpoint);
		return ref.ref;
	});
}

export function checkRelease(
	input: string,
	head: string,
	api: GitHubApi,
): ReleaseTarget {
	const version = parseReleaseVersion(input);
	const tag = `v${version}`;
	const reference = api("git/ref/heads/master");
	if (!record(reference)) return invalidResponse("git/ref/heads/master");
	const master = sha(reference.object, "git/ref/heads/master");
	if (master !== head) {
		throw new Error(
			"master が更新されています。最新 master で再実行してください。",
		);
	}
	const releases = releasePages(api("releases", true));
	const latest = releases
		.filter((release) => !release.draft && release.published_at !== null)
		.sort((a, b) =>
			(b.published_at ?? "").localeCompare(a.published_at ?? ""),
		)[0];
	if (latest) {
		// target_commitish は可変のブランチ名の場合があるため、タグの参照先を使う。
		const endpoint = `commits/${encodeURIComponent(`tags/${latest.tag_name}`)}`;
		const released = sha(api(endpoint), endpoint);
		if (released === master) {
			throw new Error(
				`最新 master と最新 Release (${latest.tag_name}) のハッシュが一致しています: ${master}`,
			);
		}
	}
	const endpoint = `git/matching-refs/tags/${encodeURIComponent(tag)}`;
	const refs = tagRefs(api(endpoint), endpoint);
	if (
		refs.includes(`refs/tags/${tag}`) ||
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
