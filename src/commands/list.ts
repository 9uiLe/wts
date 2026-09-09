import { dirtyStatus, Git, worktrees } from "../git";
import { isSameOrDescendant } from "../path";
import { repository } from "../project";
import { sessionRootBranch, stackBranches } from "../session";
import { ui } from "../ui";

export async function listSessions(): Promise<void> {
	ui.heading("list");
	const repo = await repository();
	const trees = worktrees(repo.git).filter(
		(tree) =>
			tree.path !== repo.worktreesBase &&
			isSameOrDescendant(tree.path, repo.worktreesBase),
	);
	if (!trees.length) ui.info("管理範囲に worktree はありません。");
	for (const tree of trees) {
		ui.detail("Path", tree.path);
		const git = new Git(tree.path);
		let root: string;
		try {
			root = sessionRootBranch({
				root: tree.path,
				worktreesBase: repo.worktreesBase,
				gitDir: git.run(["rev-parse", "--absolute-git-dir"]),
			});
		} catch {
			ui.detail("Session", "未管理");
			ui.detail("Current", tree.branch || "detached HEAD");
			continue;
		}
		ui.detail("Root", root);
		for (const member of stackBranches(git, root))
			ui.detail("Stack", `${member.number}: ${member.branch}`);
		ui.detail("Current", tree.branch || "detached HEAD");
		ui.detail(
			"Dirty",
			dirtyStatus(git) ? "あり（破棄には --force が必要）" : "なし",
		);
	}
}
