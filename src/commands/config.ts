import { resolve } from "node:path";
import { loadConfigFile } from "../config";
import { repository } from "../project";

export async function checkConfig(file?: string): Promise<void> {
	const loaded = file
		? loadConfigFile(resolve(file))
		: (await repository()).config;
	console.log(`設定 OK: ${loaded.path}\nWorktrees  ${loaded.worktreesBase}`);
}
