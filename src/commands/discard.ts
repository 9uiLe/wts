import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { Git, worktrees } from "../git";
import { projectBase, repository } from "../project";
import { confirmAction } from "../prompts";
import { sessionRootBranch, stackBranches } from "../session";
import { ui } from "../ui";

export async function discardSession(
	path: string,
	options: { dryRun?: boolean; yes?: boolean; force?: boolean },
): Promise<void> {
	ui.heading("discard");
	const repo = await repository();
	const target = realpathSync(resolve(path));
	const worktreesBase = realpathSync(repo.worktreesBase);
	const baseBranch = projectBase(repo.config.config).branch;
	if (target === repo.main)
		throw new Error("メイン worktree は削除できません。");
	if (target === repo.root)
		throw new Error("削除対象の worktree の外から実行してください。");

	function plan() {
		const trees = worktrees(repo.git);
		const tree = trees.find((entry) => entry.path === target);
		if (!tree)
			throw new Error(
				`登録済み worktree のルートを指定してください: ${target}`,
			);
		const block = repo.git
			.run(["worktree", "list", "--porcelain", "-z"])
			.split("\0\0")
			.find((entry) => entry.split("\0").includes(`worktree ${target}`));
		if (block?.split("\0").some((field) => /^locked(?: |$)/.test(field)))
			throw new Error(`ロックされた worktree は削除できません: ${target}`);
		const git = new Git(target);
		const root = sessionRootBranch({
			root: target,
			worktreesBase,
			gitDir: git.run(["rev-parse", "--absolute-git-dir"]),
		});
		const members = stackBranches(repo.git, root).map(({ branch }) => {
			if (branch === baseBranch)
				throw new Error(`ベースブランチは削除できません: ${branch}`);
			const other = trees.find(
				(entry) => entry.branch === branch && entry.path !== target,
			);
			if (other)
				throw new Error(
					`別の worktree で使用中のブランチは削除できません: ${branch} (${other.path})`,
				);
			const ref = repo.git.tryRun([
				"rev-parse",
				"--verify",
				`refs/heads/${branch}`,
			]);
			if (ref.code !== 0)
				throw new Error(`セッションのブランチが存在しません: ${branch}`);
			return { branch, oid: ref.out };
		});
		if (!members.some(({ branch }) => branch === tree.branch))
			throw new Error(
				"対象 worktree の現在のブランチがセッションに属していません。",
			);
		return {
			root,
			branch: tree.branch,
			head: git.run(["rev-parse", "HEAD"]),
			members,
			status: git.run([
				"--no-optional-locks",
				"status",
				"--porcelain=v1",
				"-z",
				"--untracked-files=all",
				"--ignored",
			]),
		};
	}

	const initial = plan();
	ui.detail("Worktree", target);
	for (const { branch } of initial.members) ui.detail("Branch", branch);
	ui.info(
		initial.status
			? "未コミット・未追跡・無視対象のファイルがあります。破棄には --force が必要です。"
			: "未コミット・未追跡・無視対象のファイルはありません。",
	);
	ui.info("このセッションのローカルブランチを未マージの変更ごと削除します。");
	if (options.dryRun) {
		ui.info("DRY_RUN: 削除は行いません");
		return;
	}
	if (initial.status && !options.force)
		throw new Error("ファイルを破棄する場合は --force を指定してください。");
	if (!options.yes) {
		if (!process.stdin.isTTY || !process.stdout.isTTY)
			throw new Error("非対話で削除するには --yes を指定してください。");
		if (!(await confirmAction("このセッションを破棄しますか？"))) return;
	}
	if (JSON.stringify(plan()) !== JSON.stringify(initial))
		throw new Error(
			"確認後にセッションの状態が変わりました。再実行してください。",
		);
	const removed = repo.git.tryRun([
		"worktree",
		"remove",
		...(options.force ? ["--force"] : []),
		target,
	]);
	if (removed.code !== 0)
		throw new Error(
			`worktree の削除に失敗しました。ブランチは削除していません。\n${removed.err}`,
		);
	const deleted = repo.git.tryRun(
		["update-ref", "--stdin"],
		[
			"start",
			...initial.members.map(
				({ branch, oid }) => `delete refs/heads/${branch} ${oid}`,
			),
			"prepare",
			"commit",
			"",
		].join("\n"),
	);
	if (deleted.code !== 0)
		throw new Error(
			`worktree は削除済みですが、ブランチは残っています。git branch で確認してください: ${initial.members.map(({ branch }) => branch).join(", ")}\n${deleted.err}`,
		);
	for (const { branch } of initial.members) {
		const settings = repo.git.tryRun([
			"config",
			"--local",
			"--get-regexp",
			`^branch\\.${branch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.[^.]+$`,
		]);
		if (settings.code === 1) continue;
		const result = repo.git.tryRun([
			"config",
			"--local",
			"--remove-section",
			`branch.${branch}`,
		]);
		if (settings.code !== 0 || result.code !== 0)
			throw new Error(
				`worktree とブランチは削除済みですが、ブランチ設定の削除に失敗しました: ${branch}\n${result.err}`,
			);
	}
	ui.success(`完了しました (${initial.members.length} ブランチ・1 Worktree)`);
}
