import { ensureClean } from "../git";
import { defaultNaming, generateName, validateBranchName } from "../naming";
import { repository } from "../project";
import { askText } from "../prompts";
import { sessionRootBranch, stackBranches } from "../session";
import { commandLine, ui } from "../ui";

export async function startStackBranch(options: {
	dryRun?: boolean;
	task?: string;
	prNumber?: string;
}): Promise<void> {
	ui.heading("stack");
	if (options.dryRun) ui.info("DRY_RUN: ブランチは作成しません");
	const repo = await repository();
	const root = sessionRootBranch(repo);
	ensureClean(repo.git);
	const branches = stackBranches(repo.git, root);
	const tip = branches.at(-1);
	if (!tip) throw new Error(`スタックの root ブランチが存在しません: ${root}`);
	const current = repo.git.run(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
	if (current !== tip.branch) {
		throw new Error(
			`現在のブランチ ${current} はスタックの先端ではありません。${tip.branch} に切り替えてください`,
		);
	}
	const task =
		options.task ??
		(repo.config.config.naming?.branch
			? await askText("作業内容 (Enter でスキップ)")
			: "");
	const number =
		options.prNumber || (await askText("PR 番号", String(tip.number + 1n)));
	if (!/^\d+$/.test(number) || BigInt(number) < 2n) {
		throw new Error(
			`不正な PR 番号: ${number}。2 以上の整数を指定してください`,
		);
	}
	if (branches.some((branch) => branch.number === BigInt(number))) {
		throw new Error(`PR 番号 ${number} は既に使われています`);
	}
	const suffix = await generateName(repo.config, {
		...defaultNaming(),
		kind: "branch",
		task,
		rootBranch: root,
		prNumber: number,
	});
	const branch = `${root}-pr${number}-${suffix}`;
	validateBranchName(repo.git, branch);
	if (options.dryRun) {
		ui.plan(commandLine(["git", "checkout", "-b", branch]));
	} else {
		await ui.task("スタックブランチを作成しています", () =>
			repo.git.runAsync(["checkout", "-b", branch]),
		);
	}
	if (options.dryRun) ui.info("スタックブランチの作成予定 (dry-run)");
	else ui.success("スタックブランチ準備完了");
	ui.detail("Branch", branch);
}
