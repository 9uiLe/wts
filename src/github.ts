import { commandAsync } from "./process";

export async function githubRepository(cwd: string): Promise<string> {
	const result = await commandAsync(
		"gh",
		["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
		cwd,
	);
	const owner = result.out.trim();
	if (result.code !== 0 || !owner)
		throw new Error("gh repo view でリポジトリ情報を取得できませんでした");
	return owner;
}

export async function githubCommitExists(
	cwd: string,
	owner: string,
	oid: string,
): Promise<boolean> {
	return (
		(await commandAsync("gh", ["api", `repos/${owner}/commits/${oid}`], cwd))
			.code === 0
	);
}

export async function mergedPullRequestHeads(
	cwd: string,
	owner: string,
	branch: string,
): Promise<string[]> {
	const result = await commandAsync(
		"gh",
		[
			"pr",
			"list",
			"--repo",
			owner,
			"--state",
			"merged",
			"--head",
			branch,
			"--json",
			"headRefOid,headRepository",
		],
		cwd,
	);
	if (result.code !== 0)
		throw new Error(`マージ済み PR を取得できません: ${branch}`);
	const data: unknown = JSON.parse(result.out);
	if (!Array.isArray(data)) throw new Error("gh が不正な PR 情報を返しました");
	const heads: string[] = [];
	for (const pr of data) {
		if (
			typeof pr !== "object" ||
			pr === null ||
			!("headRefOid" in pr) ||
			typeof pr.headRefOid !== "string" ||
			!("headRepository" in pr) ||
			(pr.headRepository !== null &&
				(typeof pr.headRepository !== "object" ||
					!("nameWithOwner" in pr.headRepository) ||
					typeof pr.headRepository.nameWithOwner !== "string"))
		)
			throw new Error("gh が不正な PR 情報を返しました");
		if (pr.headRepository?.nameWithOwner === owner) heads.push(pr.headRefOid);
	}
	return heads;
}
