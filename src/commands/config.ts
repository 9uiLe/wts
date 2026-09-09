import { resolve } from "node:path";
import { loadConfigFile } from "../config";
import { projectBase, repository } from "../project";
import { ui } from "../ui";

export async function checkConfig(file?: string): Promise<void> {
	ui.heading("config check");
	const loaded = file
		? loadConfigFile(resolve(file))
		: (await repository()).config;
	ui.success("設定 OK");
	ui.details([
		["Config", loaded.path],
		["Worktrees", loaded.worktreesBase],
		[
			"Base",
			loaded.config.baseBranch
				? projectBase(loaded.config).remoteRef
				: "未設定（start・restack はベース入力が必要）",
		],
		[
			"Cleanup base",
			`${projectBase(loaded.config).branch} を保護 / ${projectBase(loaded.config).remoteRef} で取り込みを判定`,
		],
		["Branch naming", loaded.config.naming?.branch?.script ?? "日付＋UUID"],
		["Worktree naming", loaded.config.naming?.worktree?.script ?? "ブランチ名"],
	]);
}
