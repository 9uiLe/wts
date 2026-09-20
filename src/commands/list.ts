import { dirtyStatus, Git, localBranches, worktrees } from "../git";
import { isSameOrDescendant } from "../path";
import { repository } from "../project";
import { readSession, type Session } from "../session";
import { ui } from "../ui";

export async function listSessions(): Promise<void> {
	ui.heading("list");
	const repo = await repository();
	const trees = worktrees(repo.git).filter(
		(tree) =>
			tree.path !== repo.worktreesBase &&
			isSameOrDescendant(tree.path, repo.worktreesBase),
	);
	if (!trees.length) {
		ui.info("管理範囲に worktree はありません。");
		return;
	}
	const refs = localBranches(repo.git);
	for (const tree of trees) {
		const git = new Git(tree.path);
		let session: Session;
		try {
			session = readSession(
				{
					root: tree.path,
					worktreesBase: repo.worktreesBase,
					gitDir: git.run(["rev-parse", "--absolute-git-dir"]),
				},
				refs,
			);
		} catch {
			ui.details([
				["Path", tree.path],
				["Session", "未管理"],
				["Current", tree.branch || "detached HEAD"],
			]);
			continue;
		}
		ui.details([
			["Path", tree.path],
			["Root", session.root],
			...session.branches.map(
				(member) => ["Stack", `${member.number}: ${member.branch}`] as const,
			),
			["Current", tree.branch || "detached HEAD"],
			["Dirty", dirtyStatus(git) ? "あり（破棄には --force が必要）" : "なし"],
		]);
	}
}
