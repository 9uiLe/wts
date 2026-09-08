import { resolve } from "node:path";
import { loadConfigFile } from "../config";
import { repository } from "../project";
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
	]);
}
