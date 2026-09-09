import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureClean, fetchBase, type Git, worktrees } from "../git";
import { supportsUpdateRefs } from "../git-version";
import { repository, resolveBaseRef } from "../project";
import { confirmAction, isInteractive } from "../prompts";
import { sessionRootBranch, stackBranches } from "../session";
import { commandLine, ui } from "../ui";

export async function restack(options: {
	dryRun?: boolean;
	pushOnly?: boolean;
	push?: boolean;
	baseBranch?: string;
}): Promise<void> {
	ui.heading("restack");
	if (options.dryRun) ui.info("DRY_RUN: rebase・push は行いません");
	if (!options.dryRun && !options.push && !isInteractive()) {
		throw new Error(
			"非対話実行には --push または PUSH=1 が必要です。wts restack --push で再実行してください。",
		);
	}
	const repo = await repository();
	const { git, gitDir } = repo;
	const root = sessionRootBranch(repo);
	ensureClean(git);
	const rebasing = () =>
		existsSync(join(gitDir, "rebase-merge")) ||
		existsSync(join(gitDir, "rebase-apply"));
	if (rebasing()) {
		throw new Error(
			"rebase が進行中です。解消後に --push-only で再実行してください",
		);
	}
	if (!options.pushOnly) {
		if (!supportsUpdateRefs(git.run(["--version"]))) {
			throw new Error(
				"restack は --update-refs を備える Git 2.38 以降が必要です",
			);
		}
	}
	const { branches, tip } = validatedStack(git, root, repo.root);
	ui.detail("スタック", branches.join(", "));
	const base = options.pushOnly
		? ""
		: await resolveBaseRef(repo.config.config, options.baseBranch);
	if (!options.pushOnly) await fetchBase(git, base, options.dryRun ?? false);
	const original =
		git.tryRun(["symbolic-ref", "--quiet", "--short", "HEAD"]).out.trim() ||
		git.run(["rev-parse", "HEAD"]).trim();
	const leaseFile = join(gitDir, "restack-lease");
	const leases = options.pushOnly
		? readSavedLeases(leaseFile, branches)
		: await fetchBranchLeases(git, branches);
	if (!options.pushOnly && !options.dryRun)
		saveLeases(leaseFile, branches, leases);
	if (options.dryRun) {
		if (!options.pushOnly) {
			ui.plan(commandLine(["git", "checkout", tip]));
			ui.plan(commandLine(["git", "rebase", "--update-refs", base]));
		}
		ui.plan(commandLine(["git", ...pushArgs(branches, leases)]));
		return;
	}
	try {
		if (!options.pushOnly) {
			git.run(["checkout", tip]);
			const result = await ui.task(`${base} をベースに rebase しています`, () =>
				git.tryRunAsync(["rebase", "--update-refs", base]),
			);
			if (result.code !== 0) {
				throw new Error(
					`rebase に失敗しました。コンフリクト解消後 git rebase --continue を実行し、wts restack --push-only で push してください\n${result.out}${result.err}`,
				);
			}
		}
		const selected = branches.filter(
			(branch) =>
				git.run(["rev-parse", `refs/heads/${branch}`]).trim() !==
				leases.get(branch),
		);
		if (selected.length > 0) {
			ui.detail("push 対象", selected.join(", "));
			if (!options.push && !(await confirmAction("これらを push しますか？"))) {
				return;
			}
			await ui.task("スタックを push しています", () =>
				git.runAsync(pushArgs(selected, leases)),
			);
		}
		unlinkSync(leaseFile);
		ui.success(
			selected.length ? "restack 完了" : "push が必要なブランチはありません",
		);
	} finally {
		if (!rebasing()) {
			const result = git.tryRun(["checkout", original]);
			if (result.code !== 0)
				ui.warn(`元のブランチへの復帰に失敗: ${result.err}`);
		}
	}
}

function validatedStack(
	git: Git,
	root: string,
	worktree: string,
): { branches: string[]; tip: string } {
	const branches = stackBranches(git, root).map(({ branch }) => branch);
	const tip = branches.at(-1);
	if (!tip) throw new Error("スタックが見つかりません");
	const checkouts = worktrees(git);
	for (const branch of branches) {
		git.run(["rev-parse", "--verify", `refs/heads/${branch}`]);
		const other = checkouts.find(
			(tree) => tree.branch === branch && tree.path !== worktree,
		);
		if (other) {
			throw new Error(
				`ブランチ ${branch} は別の worktree でチェックアウトされています: ${other.path}`,
			);
		}
	}
	for (let i = 1; i < branches.length; i++) {
		const previous = branches[i - 1];
		const current = branches[i];
		if (!previous || !current) continue;
		if (
			git.tryRun([
				"merge-base",
				"--is-ancestor",
				`refs/heads/${previous}`,
				`refs/heads/${current}`,
			]).code !== 0
		) {
			throw new Error(
				`非線形スタックは対象外です: ${current} は ${previous} の子孫ではありません`,
			);
		}
	}
	return { branches, tip };
}

function readSavedLeases(
	path: string,
	branches: string[],
): Map<string, string> {
	if (!existsSync(path)) {
		throw new Error(`rebase 開始時の lease 記録（${path}）がありません`);
	}
	const leases = new Map<string, string>();
	for (const line of readFileSync(path, "utf8").split("\n")) {
		const match = /^(\S+) ([0-9a-f]*)$/.exec(line);
		if (match?.[1] !== undefined && match[2] !== undefined)
			leases.set(match[1], match[2]);
	}
	for (const branch of branches) {
		if (!leases.has(branch))
			throw new Error(`ブランチ ${branch} の lease 記録がありません`);
	}
	return leases;
}

async function fetchBranchLeases(
	git: Git,
	branches: string[],
): Promise<Map<string, string>> {
	const remote = await ui.task("origin の lease を取得しています", () =>
		git.tryRunAsync(["ls-remote", "--heads", "origin"]),
	);
	if (remote.code !== 0) {
		throw new Error(`origin の lease を取得できません: ${remote.err}`);
	}
	const heads = new Map(
		remote.out
			.trim()
			.split("\n")
			.map((line) => {
				const [oid = "", ref = ""] = line.split(/\s+/);
				return [ref, oid];
			}),
	);
	return new Map(
		branches.map((branch) => [branch, heads.get(`refs/heads/${branch}`) ?? ""]),
	);
}

function saveLeases(
	path: string,
	branches: string[],
	leases: Map<string, string>,
): void {
	writeFileSync(
		path,
		branches.map((branch) => `${branch} ${leases.get(branch)}\n`).join(""),
	);
}

function pushArgs(branches: string[], leases: Map<string, string>): string[] {
	return [
		"push",
		"--atomic",
		...branches.map(
			(branch) =>
				`--force-with-lease=refs/heads/${branch}:${leases.get(branch)}`,
		),
		"origin",
		...branches.map((branch) => `refs/heads/${branch}:refs/heads/${branch}`),
	];
}
