import { existsSync } from "node:fs";
import { sep } from "node:path";
import { command, type Git, requireCommand, worktrees } from "../git";
import { repository } from "../project";
import { confirmAction } from "../prompts";

function patchIds(git: Git, range: string): Set<string> {
	// 差分末尾の空白も patch-id --verbatim の比較対象なので出力を trim しない。
	function pipe(args: string[], input?: string) {
		const result = Bun.spawnSync(["git", ...args], {
			cwd: git.cwd,
			stdin: input === undefined ? "ignore" : Buffer.from(input),
			stdout: "pipe",
			stderr: "pipe",
		});
		if (result.exitCode !== 0) throw new Error(result.stderr.toString());
		return result.stdout.toString();
	}
	const commits = pipe(["rev-list", "--no-merges", range]);
	const diff = pipe(["diff-tree", "--stdin", "-p"], commits);
	return new Set(
		pipe(["patch-id", "--verbatim"], diff)
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => line.split(" ")[0] as string),
	);
}

function rewriteReasons(git: Git, owner: string, branch: string, oid: string) {
	const reasons: string[] = [];
	const remote = git.tryRun([
		"ls-remote",
		"--exit-code",
		"--heads",
		"origin",
		`refs/heads/${branch}`,
	]);
	if (remote.code !== 2) {
		reasons.push(
			remote.code === 0
				? "origin にブランチが残っている"
				: "origin のブランチ有無を確認できない",
		);
	}
	if (
		command("gh", ["api", `repos/${owner}/commits/${oid}`], git.cwd).code !== 0
	) {
		reasons.push("tip が origin に無い（未 push）");
	}
	const merges = git.tryRun([
		"rev-list",
		"--count",
		"--min-parents=2",
		`origin/main..${branch}`,
	]);
	if (merges.code !== 0 || merges.out.trim() !== "0") {
		reasons.push(`独自 merge commit ${merges.out.trim() || "?"} 件`);
	}
	try {
		const base = git.run(["merge-base", "origin/main", branch]).trim();
		const main = patchIds(git, `${base}..origin/main`);
		const local = patchIds(git, `origin/main..${branch}`);
		const unmatched = [...local].filter((id) => !main.has(id)).length;
		if (unmatched) reasons.push(`パッチ非同値 ${unmatched} 件`);
	} catch {
		reasons.push("パッチ比較に失敗");
	}
	return reasons;
}

function mergedHeads(git: Git, owner: string, branch: string): string[] {
	const result = command(
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
		git.cwd,
	);
	if (result.code !== 0) {
		throw new Error(`マージ済み PR を取得できません: ${branch}\n${result.err}`);
	}
	const data: unknown = JSON.parse(result.out);
	if (!Array.isArray(data)) throw new Error("gh が不正な PR 情報を返しました");
	return data
		.filter(
			(pr) =>
				pr?.headRepository?.nameWithOwner === owner &&
				typeof pr.headRefOid === "string",
		)
		.map((pr) => pr.headRefOid);
}

export async function cleanupSessionBranches(options: {
	dryRun?: boolean;
	yes?: boolean;
}): Promise<void> {
	const { git, worktreesBase } = await repository();
	const trees = worktrees(git);
	const current = git.run(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
	const candidates = git
		.run(["for-each-ref", "--format=%(refname:short)", "refs/heads/"])
		.trim()
		.split("\n")
		.filter(
			(branch) =>
				branch &&
				branch !== "main" &&
				branch !== current &&
				!trees.some(
					(tree) =>
						tree.branch === branch &&
						!tree.path.startsWith(`${worktreesBase}${sep}`),
				),
		);
	if (options.dryRun) console.log("DRY_RUN: 削除は行いません");
	if (!candidates.length) {
		console.log("削除対象のブランチはありません");
		return;
	}
	requireCommand("gh");
	const repo = command(
		"gh",
		["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
		git.cwd,
	);
	const owner = repo.out.trim();
	if (repo.code !== 0 || !owner) {
		throw new Error("gh repo view でリポジトリ情報を取得できませんでした");
	}
	if (
		!options.dryRun &&
		git.tryRun(["fetch", "-q", "origin", "main"]).code !== 0
	) {
		console.error(
			"origin/main の fetch に失敗しました（判定が古い状態で行われます）",
		);
	}
	const automatic: { branch: string; path: string | undefined }[] = [];
	for (const branch of candidates) {
		const oid = git
			.run(["rev-parse", "--verify", `refs/heads/${branch}`])
			.trim();
		const heads = mergedHeads(git, owner, branch);
		if (!heads.length) continue;
		const reasons =
			heads.includes(oid) ||
			git.tryRun(["merge-base", "--is-ancestor", oid, "origin/main"]).code === 0
				? []
				: rewriteReasons(git, owner, branch, oid);
		const path = trees.find((tree) => tree.branch === branch)?.path;
		if (reasons.length) {
			console.log(`要確認: ${branch} (${reasons.join("、")})`);
			if (path)
				console.log(`  git worktree remove '${path.replaceAll("'", "'\\''")}'`);
			console.log(`  git branch -D '${branch.replaceAll("'", "'\\''")}'`);
		} else {
			automatic.push({ branch, path });
			console.log(`削除対象: ${branch}${path ? ` (${path})` : ""}`);
		}
	}
	if (options.dryRun || !automatic.length) return;
	if (!options.yes && !(await confirmAction("これらを削除しますか？"))) {
		console.log("キャンセルしました");
		return;
	}
	const failed: string[] = [];
	let removedTrees = 0;
	let removedBranches = 0;
	for (const { branch, path } of automatic) {
		if (path && existsSync(path)) {
			if (git.tryRun(["worktree", "remove", "--force", path]).code !== 0) {
				failed.push(branch);
				continue;
			}
			removedTrees++;
		}
		// 書き換え前の tip は main の祖先ではないため、分類で証明した上で -D を使う。
		if (git.tryRun(["branch", "-D", branch]).code !== 0) failed.push(branch);
		else removedBranches++;
	}
	git.run(["worktree", "prune"]);
	if (failed.length)
		throw new Error(`削除に失敗したブランチ: ${failed.join(", ")}`);
	console.log(
		`完了しました (${removedBranches} ブランチ・${removedTrees} Worktree)`,
	);
}
