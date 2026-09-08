import { getSkillGuide, installSkillFiles } from "../skills";
import { ui } from "../ui";

export function getSkill(name: string): void {
	process.stdout.write(getSkillGuide(name));
}

export async function installSkill(
	name: string,
	options: { path?: string; force?: boolean },
): Promise<void> {
	const installation = await installSkillFiles(name, options);
	ui.success(
		installation.changed
			? `スキルをインストールしました: ${installation.path}`
			: `導入済みです: ${installation.path}`,
	);
}
