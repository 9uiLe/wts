import { initializeConfig } from "../config";
import { repositoryLocation } from "../project";
import { ui } from "../ui";

export function init(): void {
	ui.heading("init");
	const { root, main } = repositoryLocation();
	const path = initializeConfig(root, main);
	ui.success("設定を生成しました");
	ui.details([
		["Config", path],
		["Next", "wts config check"],
	]);
}
