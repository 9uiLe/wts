import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { Git, worktrees } from "../git";
import { projectBase, repository } from "../project";
import { confirmAction } from "../prompts";
import { sessionRootBranch, stackBranches } from "../session";
import { ui } from "../ui";

export async function discardSession(
	path: string,
	options: {
		dryRun?: boolean;
		yes?: boolean;
		force?: boolean;
		remote?: string;
	},
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
		let remote:
			| { name: string; url: string; refs: { ref: string; oid: string }[] }
			| undefined;
		if (options.remote !== undefined) {
			if (
				!repo.git.run(["remote"]).split("\n").includes(options.remote) ||
				!options.remote ||
				options.remote.startsWith("-")
			)
				throw new Error(
					`設定済みのリモート名を指定してください: ${options.remote}`,
				);
			const urls = repo.git
				.run(["remote", "get-url", "--push", "--all", options.remote])
				.split("\n");
			// Git の atomic push は複数の送信先をまたぐ削除を保証できない。
			if (urls.length !== 1 || !urls[0])
				throw new Error("push URL が 1 つのリモートを指定してください。");
			const url = urls[0];
			const listed = repo.git.tryRun(["ls-remote", "--heads", "--", url]);
			if (listed.code !== 0)
				throw new Error(
					`リモートブランチを取得できませんでした: ${options.remote}`,
				);
			const refs = new Map(
				listed.out
					.split("\n")
					.filter(Boolean)
					.map((line) => {
						const [oid, ref] = line.split("\t");
						return [ref, oid] as const;
					}),
			);
			remote = {
				name: options.remote,
				url,
				refs: members.flatMap(({ branch }) => {
					const ref = `refs/heads/${branch}`;
					const oid = refs.get(ref);
					return oid ? [{ ref, oid }] : [];
				}),
			};
		}
		return {
			root,
			branch: tree.branch,
			head: git.run(["rev-parse", "HEAD"]),
			members,
			remote,
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
	if (initial.remote) {
		ui.detail("Remote", initial.remote.name);
		for (const { ref } of initial.remote.refs) ui.detail("Remote branch", ref);
		ui.info(
			initial.remote.refs.length
				? "表示したリモートブランチも未マージの変更ごと削除します。"
				: "リモートに同名のブランチはありません。",
		);
	}
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
	let remoteDeleted = "";
	if (initial.remote?.refs.length) {
		const deleted = repo.git.tryRun([
			"push",
			"--atomic",
			"--no-follow-tags",
			...initial.remote.refs.map(
				({ ref, oid }) => `--force-with-lease=${ref}:${oid}`,
			),
			"--",
			initial.remote.url,
			...initial.remote.refs.map(({ ref }) => `:${ref}`),
		]);
		if (deleted.code !== 0)
			throw new Error(
				"リモートブランチの削除に失敗しました。ローカルのセッションは削除していません。リモートの状態を確認してください。",
			);
		remoteDeleted = "リモートブランチは削除済みです。";
	}
	const removed = repo.git.tryRun([
		"worktree",
		"remove",
		...(options.force ? ["--force"] : []),
		target,
	]);
	if (removed.code !== 0)
		throw new Error(
			`${remoteDeleted}worktree の削除に失敗しました。ローカルブランチは削除していません。\n${removed.err}`,
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
			`${remoteDeleted}worktree は削除済みですが、ブランチは残っています。git branch で確認してください: ${initial.members.map(({ branch }) => branch).join(", ")}\n${deleted.err}`,
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
				`${remoteDeleted}worktree とブランチは削除済みですが、ブランチ設定の削除に失敗しました: ${branch}\n${result.err}`,
			);
	}
	ui.success(
		`完了しました (${initial.members.length} ブランチ・1 Worktree${initial.remote ? `・${initial.remote.refs.length} リモートブランチ` : ""})`,
	);
}
