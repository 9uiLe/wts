import { lstatSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { copyUnmanaged } from "../copy";
import { fetchBase, validateRef, worktrees } from "../git";
import {
	defaultNaming,
	generateName,
	validateBranchName,
	validateWorktreeName,
} from "../naming";
import { repository } from "../project";
import { askText } from "../prompts";
import { recordSession } from "../session";

export async function startWorktreeSession(options: {
	dryRun?: boolean;
	task?: string;
	baseBranch?: string;
	copyFrom?: string;
}): Promise<void> {
	const repo = await repository();
	const task =
		options.task ??
		(repo.config.config.naming?.branch || repo.config.config.naming?.worktree
			? await askText("作業内容 (Enter でスキップ)")
			: "");
	const base =
		options.baseBranch || (await askText("ベースブランチ", "origin/main"));
	validateRef(base);
	const naming = defaultNaming();
	const branch = generateName(repo.config, { ...naming, kind: "branch", task });
	validateBranchName(repo.git, branch);
	const worktree = generateName(repo.config, {
		...naming,
		kind: "worktree",
		task,
		branch,
		defaultName: branch.replaceAll("/", "-"),
	});
	validateWorktreeName(worktree);
	const target = join(repo.worktreesBase, worktree);
	try {
		lstatSync(target);
		throw new Error(`Worktree の作成先は既に存在します: ${target}`);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	if (worktrees(repo.git).some((wt) => wt.path === target))
		throw new Error(`Worktree は既に登録されています: ${target}`);
	const dryRun = options.dryRun ?? false;
	fetchBase(repo.git, base, dryRun);
	const source = options.copyFrom
		? resolve(repo.root, options.copyFrom)
		: (!base.startsWith("origin/") &&
				worktrees(repo.git).find((wt) => wt.branch === base)?.path) ||
			repo.main;
	if (dryRun) {
		console.log(`dry-run: git worktree add -b ${branch} ${target} ${base}`);
	} else {
		mkdirSync(repo.worktreesBase, { recursive: true });
		repo.git.run(["worktree", "add", "-b", branch, target, base]);
		recordSession(repo.git, target, branch);
	}
	copyUnmanaged(join(repo.root, ".worktree-copy"), source, target, dryRun);
	console.log(
		`Worktree 準備完了${dryRun ? " (dry-run)" : ""}\nBranch  ${branch}\nPath    ${target}`,
	);
}
