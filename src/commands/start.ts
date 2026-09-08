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
import { commandLine, ui } from "../ui";

export async function startWorktreeSession(options: {
	dryRun?: boolean;
	task?: string;
	baseBranch?: string;
	copyFrom?: string;
}): Promise<void> {
	ui.heading("start");
	if (options.dryRun) ui.info("DRY_RUN: Worktree は作成しません");
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
	const branch = await generateName(repo.config, {
		...naming,
		kind: "branch",
		task,
	});
	validateBranchName(repo.git, branch);
	const worktree = await generateName(repo.config, {
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
	await fetchBase(repo.git, base, dryRun);
	const source = options.copyFrom
		? resolve(repo.root, options.copyFrom)
		: (!base.startsWith("origin/") &&
				worktrees(repo.git).find((wt) => wt.branch === base)?.path) ||
			repo.main;
	if (dryRun) {
		ui.plan(
			commandLine(["git", "worktree", "add", "-b", branch, target, base]),
		);
	} else {
		mkdirSync(repo.worktreesBase, { recursive: true });
		await ui.task("Worktree を作成しています", () =>
			repo.git.runAsync(["worktree", "add", "-b", branch, target, base]),
		);
		recordSession(repo.git, target, branch);
	}
	copyUnmanaged(join(repo.root, ".worktree-copy"), source, target, dryRun);
	if (dryRun) ui.info("Worktree の作成予定 (dry-run)");
	else ui.success("Worktree 準備完了");
	ui.details([
		["Branch", branch],
		["Path", target],
		...(!dryRun ? [["Next", commandLine(["cd", target])] as const] : []),
	]);
}
