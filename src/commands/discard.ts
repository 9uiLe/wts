import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { Git, worktrees } from "../git";
import { projectBase, repository } from "../project";
import { confirmAction } from "../prompts";
import { sessionRootBranch, stackBranches } from "../session";
import { ui } from "../ui";

type DiscardOptions = {
	dryRun?: boolean;
	yes?: boolean;
	force?: boolean;
	remote?: string;
};

type LocalBranch = { branch: string; oid: string };
type RemoteDeletion = {
	name: string;
	url: string;
	refs: { ref: string; oid: string }[];
};
type DiscardContext = {
	repo: Awaited<ReturnType<typeof repository>>;
	target: string;
	worktreesBase: string;
	baseBranch: string;
};
type DiscardPlan = {
	target: string;
	root: string;
	branch: string;
	head: string;
	members: LocalBranch[];
	remote: RemoteDeletion | undefined;
	status: string;
};
type DiscardProgress = {
	remoteDeleted: boolean;
	local: "intact" | "worktree-deleted" | "branches-deleted";
};

export async function discardSession(
	path: string,
	options: DiscardOptions,
): Promise<void> {
	ui.heading("discard");
	const context = await discardContext(path);
	const plan = planDiscard(context, options.remote);
	displayPlan(plan);
	if (options.dryRun) {
		ui.info("DRY_RUN: 削除は行いません");
		return;
	}
	if (!(await confirmDiscard(plan, options))) return;
	if (
		JSON.stringify(planDiscard(context, options.remote)) !==
		JSON.stringify(plan)
	)
		throw new Error(
			"確認後にセッションの状態が変わりました。再実行してください。",
		);
	executeDiscard(context.repo.git, plan, options);
	ui.success(
		`完了しました (${plan.members.length} ブランチ・1 Worktree${plan.remote ? `・${plan.remote.refs.length} リモートブランチ` : ""})`,
	);
}

async function discardContext(path: string): Promise<DiscardContext> {
	const repo = await repository();
	const target = realpathSync(resolve(path));
	const worktreesBase = realpathSync(repo.worktreesBase);
	const baseBranch = projectBase(repo.config.config).branch;
	if (target === repo.main)
		throw new Error("メイン worktree は削除できません。");
	if (target === repo.root)
		throw new Error("削除対象の worktree の外から実行してください。");

	return { repo, target, worktreesBase, baseBranch };
}

function planDiscard(
	{ repo, target, worktreesBase, baseBranch }: DiscardContext,
	remoteName: string | undefined,
): DiscardPlan {
	const trees = worktrees(repo.git);
	const tree = trees.find((entry) => entry.path === target);
	if (!tree)
		throw new Error(`登録済み worktree のルートを指定してください: ${target}`);
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
	const remote = planRemoteDeletion(repo.git, remoteName, members);
	return {
		target,
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

function planRemoteDeletion(
	git: Git,
	name: string | undefined,
	members: LocalBranch[],
): RemoteDeletion | undefined {
	if (name === undefined) return undefined;
	if (
		!git.run(["remote"]).split("\n").includes(name) ||
		!name ||
		name.startsWith("-")
	)
		throw new Error(`設定済みのリモート名を指定してください: ${name}`);
	const urls = git
		.run(["remote", "get-url", "--push", "--all", name])
		.split("\n");
	// Git の atomic push は複数の送信先をまたぐ削除を保証できない。
	if (urls.length !== 1 || !urls[0])
		throw new Error("push URL が 1 つのリモートを指定してください。");
	const url = urls[0];
	const listed = git.tryRun(["ls-remote", "--heads", "--", url]);
	if (listed.code !== 0)
		throw new Error(`リモートブランチを取得できませんでした: ${name}`);
	const refs = new Map(
		listed.out
			.split("\n")
			.filter(Boolean)
			.map((line) => {
				const [oid, ref] = line.split("\t");
				return [ref, oid] as const;
			}),
	);
	return {
		name,
		url,
		refs: members.flatMap(({ branch }) => {
			const ref = `refs/heads/${branch}`;
			const oid = refs.get(ref);
			return oid ? [{ ref, oid }] : [];
		}),
	};
}

function displayPlan(plan: DiscardPlan): void {
	ui.detail("Worktree", plan.target);
	for (const { branch } of plan.members) ui.detail("Branch", branch);
	if (plan.remote) {
		ui.detail("Remote", plan.remote.name);
		for (const { ref } of plan.remote.refs) ui.detail("Remote branch", ref);
		ui.info(
			plan.remote.refs.length
				? "表示したリモートブランチも未マージの変更ごと削除します。"
				: "リモートに同名のブランチはありません。",
		);
	}
	ui.info(
		plan.status
			? "未コミット・未追跡・無視対象のファイルがあります。破棄には --force が必要です。"
			: "未コミット・未追跡・無視対象のファイルはありません。",
	);
	ui.info("このセッションのローカルブランチを未マージの変更ごと削除します。");
}

async function confirmDiscard(
	plan: DiscardPlan,
	options: DiscardOptions,
): Promise<boolean> {
	if (plan.status && !options.force)
		throw new Error("ファイルを破棄する場合は --force を指定してください。");
	if (!options.yes) {
		if (!process.stdin.isTTY || !process.stdout.isTTY)
			throw new Error("非対話で削除するには --yes を指定してください。");
		if (!(await confirmAction("このセッションを破棄しますか？"))) return false;
	}
	return true;
}

function executeDiscard(
	git: Git,
	plan: DiscardPlan,
	options: DiscardOptions,
): void {
	const progress: DiscardProgress = { remoteDeleted: false, local: "intact" };
	if (plan.remote?.refs.length) {
		// Git の診断には認証情報を含む URL が出るため、そのまま表示しない。
		const deleted = git.tryRun([
			"push",
			"--atomic",
			"--no-follow-tags",
			...plan.remote.refs.map(
				({ ref, oid }) => `--force-with-lease=${ref}:${oid}`,
			),
			"--",
			plan.remote.url,
			...plan.remote.refs.map(({ ref }) => `:${ref}`),
		]);
		if (deleted.code !== 0)
			throw new Error(
				"リモートブランチの削除に失敗しました。ローカルのセッションは削除していません。リモートの状態を確認してください。",
			);
		progress.remoteDeleted = true;
	}
	const removed = git.tryRun([
		"worktree",
		"remove",
		...(options.force ? ["--force"] : []),
		plan.target,
	]);
	if (removed.code !== 0)
		throw localDeletionFailure(progress, plan, removed.err);
	progress.local = "worktree-deleted";
	const deleted = git.tryRun(
		["update-ref", "--stdin"],
		[
			"start",
			...plan.members.map(
				({ branch, oid }) => `delete refs/heads/${branch} ${oid}`,
			),
			"prepare",
			"commit",
			"",
		].join("\n"),
	);
	if (deleted.code !== 0)
		throw localDeletionFailure(progress, plan, deleted.err);
	progress.local = "branches-deleted";
	for (const { branch } of plan.members) {
		const settings = git.tryRun([
			"config",
			"--local",
			"--get-regexp",
			`^branch\\.${branch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.[^.]+$`,
		]);
		if (settings.code === 1) continue;
		const result = git.tryRun([
			"config",
			"--local",
			"--remove-section",
			`branch.${branch}`,
		]);
		if (settings.code !== 0 || result.code !== 0)
			throw localDeletionFailure(progress, plan, result.err, branch);
	}
}

function localDeletionFailure(
	progress: DiscardProgress,
	plan: DiscardPlan,
	detail: string,
	branch?: string,
): Error {
	const remote = progress.remoteDeleted
		? "リモートブランチは削除済みです。"
		: "";
	switch (progress.local) {
		case "intact":
			return new Error(
				`${remote}worktree の削除に失敗しました。ローカルブランチは削除していません。\n${detail}`,
			);
		case "worktree-deleted":
			return new Error(
				`${remote}worktree は削除済みですが、ブランチは残っています。git branch で確認してください: ${plan.members.map(({ branch }) => branch).join(", ")}\n${detail}`,
			);
		case "branches-deleted":
			return new Error(
				`${remote}worktree とブランチは削除済みですが、ブランチ設定の削除に失敗しました: ${branch}\n${detail}`,
			);
	}
}
