import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureClean, fetchBase, worktrees } from "../git";
import { repository } from "../project";
import { askText, confirmAction } from "../prompts";
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
		const version = /git version (\d+)\.(\d+)/.exec(git.run(["--version"]));
		if (
			!version ||
			Number(version[1]) < 2 ||
			(Number(version[1]) === 2 && Number(version[2]) < 38)
		) {
			throw new Error(
				"restack は --update-refs を備える Git 2.38 以降が必要です",
			);
		}
	}
	const branches = stackBranches(git, root).map(({ branch }) => branch);
	const tip = branches.at(-1);
	if (!tip) throw new Error("スタックが見つかりません");
	const checkouts = worktrees(git);
	for (const branch of branches) {
		git.run(["rev-parse", "--verify", `refs/heads/${branch}`]);
		const other = checkouts.find(
			(wt) => wt.branch === branch && wt.path !== repo.root,
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
	ui.detail("スタック", branches.join(", "));
	const base =
		options.baseBranch || (await askText("ベースブランチ", "origin/main"));
	await fetchBase(git, base, options.dryRun ?? false);
	const original =
		git.tryRun(["symbolic-ref", "--quiet", "--short", "HEAD"]).out.trim() ||
		git.run(["rev-parse", "HEAD"]).trim();
	const leaseFile = join(gitDir, "restack-lease");
	const leases = new Map<string, string>();
	if (options.pushOnly) {
		if (!existsSync(leaseFile)) {
			throw new Error(`rebase 開始時の lease 記録（${leaseFile}）がありません`);
		}
		for (const line of readFileSync(leaseFile, "utf8").split("\n")) {
			const match = /^(\S+) ([0-9a-f]*)$/.exec(line);
			if (match?.[1] !== undefined && match[2] !== undefined) {
				leases.set(match[1], match[2]);
			}
		}
		for (const branch of branches) {
			if (!leases.has(branch)) {
				throw new Error(`ブランチ ${branch} の lease 記録がありません`);
			}
		}
	} else {
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
		for (const branch of branches) {
			leases.set(branch, heads.get(`refs/heads/${branch}`) ?? "");
		}
		if (!options.dryRun) {
			writeFileSync(
				leaseFile,
				branches.map((branch) => `${branch} ${leases.get(branch)}\n`).join(""),
			);
		}
	}
	const pushArgs = (selected: string[]) => [
		"push",
		"--atomic",
		...selected.map(
			(branch) =>
				`--force-with-lease=refs/heads/${branch}:${leases.get(branch)}`,
		),
		"origin",
		...selected.map((branch) => `refs/heads/${branch}:refs/heads/${branch}`),
	];
	if (options.dryRun) {
		if (!options.pushOnly) {
			ui.plan(commandLine(["git", "checkout", tip]));
			ui.plan(commandLine(["git", "rebase", "--update-refs", base]));
		}
		ui.plan(commandLine(["git", ...pushArgs(branches)]));
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
				git.runAsync(pushArgs(selected)),
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
