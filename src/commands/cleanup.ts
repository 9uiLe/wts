import { type Git, localBranches, worktrees } from "../git";
import {
	githubCommitExists,
	githubRepository,
	mergedPullRequestHeads,
} from "../github";
import { isSameOrDescendant } from "../path";
import { commandAsync, requireCommand } from "../process";
import { projectBase, repository } from "../project";
import { confirmAction } from "../prompts";
import { commandLine, ui } from "../ui";

async function patchIds(git: Git, range: string): Promise<Set<string>> {
	// 差分末尾の空白も patch-id --verbatim の比較対象なので出力を trim しない。
	async function pipe(args: string[], input?: string) {
		const result = await commandAsync("git", args, git.cwd, input);
		if (result.code !== 0) throw new Error("パッチ比較に失敗");
		return result.out;
	}
	const commits = await pipe(["rev-list", "--no-merges", range]);
	const diff = await pipe(["diff-tree", "--stdin", "-p"], commits);
	return new Set(
		(await pipe(["patch-id", "--verbatim"], diff))
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => line.split(" ")[0] as string),
	);
}

async function rewriteReasons(
	git: Git,
	owner: string,
	branch: string,
	oid: string,
	remoteBase: string,
) {
	const reasons: string[] = [];
	const remote = await git.tryRunAsync([
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
	if (!(await githubCommitExists(git.cwd, owner, oid))) {
		reasons.push("tip が origin に無い（未 push）");
	}
	const merges = git.tryRun([
		"rev-list",
		"--count",
		"--min-parents=2",
		`${remoteBase}..${oid}`,
	]);
	if (merges.code !== 0 || merges.out.trim() !== "0") {
		reasons.push(`独自 merge commit ${merges.out.trim() || "?"} 件`);
	}
	try {
		const base = git.run(["merge-base", remoteBase, oid]).trim();
		const upstream = await patchIds(git, `${base}..${remoteBase}`);
		const local = await patchIds(git, `${remoteBase}..${oid}`);
		const unmatched = [...local].filter((id) => !upstream.has(id)).length;
		if (unmatched) reasons.push(`パッチ非同値 ${unmatched} 件`);
	} catch {
		reasons.push("パッチ比較に失敗");
	}
	return reasons;
}

interface CleanupTarget {
	branch: string;
	oid: string;
	path: string | undefined;
}

interface CleanupFailure {
	branch: string;
	path: string | undefined;
	phase: "再検証" | "worktree 削除" | "参照削除" | "ブランチ設定除去" | "prune";
	diagnostic: string;
}

function cleanupCandidates(
	git: Git,
	worktreesBase: string,
	baseBranch: string,
) {
	const trees = worktrees(git);
	const current = git.run(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
	const candidates = [...localBranches(git)].filter(
		([branch]) =>
			branch !== baseBranch &&
			branch !== current &&
			!trees.some(
				(tree) =>
					tree.branch === branch &&
					(tree.path === worktreesBase ||
						!isSameOrDescendant(tree.path, worktreesBase)),
			),
	);
	return { candidates, trees };
}

async function classifyBranches(
	git: Git,
	owner: string,
	remoteBase: string,
	candidates: [string, string][],
	trees: ReturnType<typeof worktrees>,
): Promise<CleanupTarget[]> {
	const automatic: CleanupTarget[] = [];
	for (const [branch, oid] of candidates) {
		const heads = await ui.task(
			`${branch} のマージ済み PR を確認しています`,
			() => mergedPullRequestHeads(git.cwd, owner, branch),
		);
		if (!heads.length) continue;
		const reasons =
			heads.includes(oid) ||
			git.tryRun(["merge-base", "--is-ancestor", oid, remoteBase]).code === 0
				? []
				: await ui.task(`${branch} の変更を比較しています`, () =>
						rewriteReasons(git, owner, branch, oid, remoteBase),
					);
		const path = trees.find((tree) => tree.branch === branch)?.path;
		if (reasons.length) {
			ui.warn(`要確認: ${branch} (${reasons.join("、")})`);
			if (path)
				ui.line(`  ${commandLine(["git", "worktree", "remove", path])}`);
			ui.line(`  ${commandLine(["git", "branch", "-D", branch])}`);
		} else {
			automatic.push({ branch, oid, path });
			ui.info(`削除対象: ${branch}${path ? ` (${path})` : ""}`);
		}
	}
	return automatic;
}

function targetChanged(
	git: Git,
	{ branch, oid, path }: CleanupTarget,
): boolean {
	const tip = git.tryRun(["rev-parse", "--verify", `refs/heads/${branch}`]);
	const registered = worktrees(git);
	const current = git.run(["rev-parse", "--abbrev-ref", "HEAD"]);
	const users = registered.filter((tree) => tree.branch === branch);
	return (
		tip.code !== 0 ||
		tip.out !== oid ||
		current === branch ||
		(path
			? users.length !== 1 ||
				users[0]?.path !== path ||
				registered.some((tree) => tree.path === path && tree.branch !== branch)
			: users.length !== 0)
	);
}

interface CleanupResult {
	failures: CleanupFailure[];
	removedTrees: number;
	removedBranches: number;
}

async function removeTarget(
	git: Git,
	target: CleanupTarget,
	result: CleanupResult,
): Promise<void> {
	const { failures } = result;

	const { branch, oid, path } = target;
	let phase: CleanupFailure["phase"] = "再検証";
	try {
		if (targetChanged(git, target)) {
			failures.push({
				...target,
				phase,
				diagnostic: "分類後に OID または worktree の対応が変わりました",
			});
			return;
		}
		if (path) {
			phase = "worktree 削除";
			const removal = await ui.task(
				`${branch} の Worktree を削除しています`,
				() => git.tryRunAsync(["worktree", "remove", "--force", path]),
			);
			if (removal.code !== 0) {
				failures.push({
					...target,
					phase,
					diagnostic: "Worktree を削除できませんでした",
				});
				return;
			}
			result.removedTrees++;
		}
		phase = "参照削除";
		if (worktrees(git).some((tree) => tree.branch === branch)) {
			failures.push({
				...target,
				phase,
				diagnostic: "ブランチが worktree で使用中です",
			});
			return;
		}
		const deletion = await git.tryRunAsync([
			"update-ref",
			"-d",
			`refs/heads/${branch}`,
			oid,
		]);
		if (deletion.code !== 0) {
			failures.push({
				...target,
				phase,
				diagnostic: "OID の照合または参照削除に失敗しました",
			});
			return;
		}
		result.removedBranches++;
		phase = "ブランチ設定除去";
		const settings = git.tryRun([
			"config",
			"--local",
			"--remove-section",
			`branch.${branch}`,
		]);
		const absent =
			settings.code !== 0 &&
			git.tryRun([
				"config",
				"--local",
				"--get-regexp",
				`^branch\\.${branch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.`,
			]).code === 1;
		if (settings.code !== 0 && !absent)
			failures.push({
				...target,
				phase,
				diagnostic: "参照削除済み・設定残存",
			});
	} catch {
		failures.push({
			...target,
			phase,
			diagnostic:
				phase === "ブランチ設定除去"
					? "参照削除済み・設定残存"
					: "処理を完了できませんでした",
		});
	}
}

async function pruneWorktrees(
	git: Git,
	failures: CleanupFailure[],
): Promise<void> {
	try {
		if ((await git.tryRunAsync(["worktree", "prune"])).code !== 0)
			failures.push({
				branch: "",
				path: undefined,
				phase: "prune",
				diagnostic: "Worktree 登録情報の整理に失敗しました",
			});
	} catch {
		failures.push({
			branch: "",
			path: undefined,
			phase: "prune",
			diagnostic: "Worktree 登録情報の整理に失敗しました",
		});
	}
}

function reportCleanup({
	failures,
	removedTrees,
	removedBranches,
}: CleanupResult): void {
	ui.info(`完了済み: ${removedBranches} ブランチ・${removedTrees} Worktree`);
	for (const failure of failures) {
		ui.warn(
			`${failure.phase}: ${failure.branch || "worktree"}${failure.path ? ` (${failure.path})` : ""}: ${failure.diagnostic}`,
		);
		if (failure.phase === "prune") {
			ui.line(`  ${commandLine(["git", "worktree", "prune"])}`);
		} else if (failure.phase === "ブランチ設定除去") {
			ui.line(
				`  ${commandLine(["git", "config", "--local", "--remove-section", `branch.${failure.branch}`])}`,
			);
		} else {
			ui.line(`残存対象: ${failure.branch}`);
			if (failure.path)
				ui.line(
					`  ${commandLine(["git", "worktree", "remove", "--force", failure.path])}`,
				);
			ui.line(`  ${commandLine(["git", "branch", "-D", failure.branch])}`);
		}
	}
	if (failures.length)
		throw new Error(`cleanup の一部処理に失敗しました (${failures.length} 件)`);
	ui.success(
		`完了しました (${removedBranches} ブランチ・${removedTrees} Worktree)`,
	);
}

export async function cleanupSessionBranches(options: {
	dryRun?: boolean;
	yes?: boolean;
}): Promise<void> {
	ui.heading("cleanup");
	const { git, worktreesBase, config } = await repository();
	const { branch: baseBranch, remoteRef: remoteBase } = projectBase(
		config.config,
	);
	const { candidates, trees } = cleanupCandidates(
		git,
		worktreesBase,
		baseBranch,
	);
	if (options.dryRun) ui.info("DRY_RUN: 削除は行いません");
	if (!candidates.length) {
		ui.info("削除対象のブランチはありません");
		return;
	}
	requireCommand("gh");
	const owner = await ui.task("GitHub リポジトリを確認しています", () =>
		githubRepository(git.cwd),
	);
	if (
		!options.dryRun &&
		(
			await ui.task(`${remoteBase} を取得しています`, () =>
				git.tryRunAsync(["fetch", "-q", "origin", baseBranch]),
			)
		).code !== 0
	) {
		ui.warn(
			`${remoteBase} の fetch に失敗しました（判定が古い状態で行われます）`,
		);
	}
	const automatic = await classifyBranches(
		git,
		owner,
		remoteBase,
		candidates,
		trees,
	);
	if (!automatic.length) {
		ui.info("自動削除できるブランチはありません");
		return;
	}
	if (options.dryRun) {
		ui.info(`削除予定: ${automatic.length} ブランチ`);
		return;
	}
	if (!options.yes && !(await confirmAction("これらを削除しますか？"))) {
		return;
	}
	const result: CleanupResult = {
		failures: [],
		removedTrees: 0,
		removedBranches: 0,
	};
	for (const target of automatic) await removeTarget(git, target, result);
	await pruneWorktrees(git, result.failures);
	reportCleanup(result);
}
