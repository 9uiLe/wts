import { initializeConfig } from "../config";
import { repositoryLocation } from "../project";

export function init(): void {
	const { root, main } = repositoryLocation();
	console.log(`設定を生成しました: ${initializeConfig(root, main)}`);
}
