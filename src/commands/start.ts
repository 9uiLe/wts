import { lstatSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { copyUnmanaged, readCopyList } from "../copy";
import { fetchBase, type Git, validateRef, worktrees } from "../git";
import {
	defaultNaming,
	generateName,
	validateBranchName,
	validateWorktreeName,
} from "../naming";
import { repository, resolveBaseRef } from "../project";
import { askText } from "../prompts";
import { recordSession } from "../session";
import { commandLine, ui } from "../ui";

type Repository = Awaited<ReturnType<typeof repository>>;

interface StartOptions {
	dryRun?: boolean;
	task?: string;
	baseBranch?: string;
	copyFrom?: string;
}

interface SessionCreation {
	branch: string;
	target: string;
	base: string;
	source: string;
	copyList: string[];
}

async function resolveCreation(
	repo: Repository,
	options: StartOptions,
): Promise<SessionCreation> {
	const task =
		options.task ??
		(repo.config.config.naming?.branch || repo.config.config.naming?.worktree
			? await askText("作業内容 (Enter でスキップ)")
			: "");
	const base = await resolveBaseRef(repo.config.config, options.baseBranch);
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
	const copyList = readCopyList(join(repo.root, ".worktree-copy"));

	const source = options.copyFrom
		? resolve(repo.root, options.copyFrom)
		: (!base.startsWith("origin/") &&
				worktrees(repo.git).find((wt) => wt.branch === base)?.path) ||
			repo.main;
	return { branch, target, base, source, copyList };
}

function reportCreationState(
	git: Git,
	target: string,
	branch: string,
	sessionRecorded: boolean,
): void {
	ui.details([
		["Path", target],
		["Branch", branch],
		[
			"Worktree",
			worktrees(git).some((wt) => wt.path === target) ? "作成済み" : "未作成",
		],
		[
			"ブランチ",
			git.tryRun(["show-ref", "--verify", `refs/heads/${branch}`]).code === 0
				? "作成済み"
				: "未作成",
		],
		["セッション記録", sessionRecorded ? "作成済み" : "未作成"],
	]);
}

async function createSession(
	repo: Repository,
	creation: SessionCreation,
): Promise<void> {
	const { branch, target, base, source, copyList } = creation;
	let sessionRecorded = false;
	try {
		mkdirSync(repo.worktreesBase, { recursive: true });
		await ui.task("Worktree を作成しています", () =>
			repo.git.runAsync(["worktree", "add", "-b", branch, target, base]),
		);
		recordSession(repo.git, target, branch);
		sessionRecorded = true;
		copyUnmanaged(copyList, source, target, false);
	} catch (error) {
		reportCreationState(repo.git, target, branch, sessionRecorded);
		throw error;
	}
}

export async function startWorktreeSession(
	options: StartOptions,
): Promise<void> {
	ui.heading("start");
	if (options.dryRun) ui.info("DRY_RUN: Worktree は作成しません");
	const repo = await repository();
	const creation = await resolveCreation(repo, options);
	const { branch, target, base, source, copyList } = creation;
	const dryRun = options.dryRun ?? false;
	await fetchBase(repo.git, base, dryRun);
	if (dryRun) {
		ui.plan(
			commandLine(["git", "worktree", "add", "-b", branch, target, base]),
		);
		copyUnmanaged(copyList, source, target, true);
		ui.info("Worktree の作成予定 (dry-run)");
	} else {
		await createSession(repo, creation);
		ui.success("Worktree 準備完了");
	}
	ui.details([
		["Branch", branch],
		["Path", target],
		...(!dryRun ? [["Next", commandLine(["cd", target])] as const] : []),
	]);
}
