import {
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import discovery from "../../skills/wts-cli/SKILL.md" with { type: "text" };
import guide from "../../skills/wts-cli/references/guide.md" with {
	type: "text",
};
import { ui } from "../ui";

function checkName(name: string): void {
	if (name !== "wts-cli")
		throw new Error(`未知のスキル: ${name}（利用可能: wts-cli）`);
}

export function getSkill(name: string): void {
	checkName(name);
	process.stdout.write(guide);
}

export async function installSkill(
	name: string,
	options: { path?: string; force?: boolean },
): Promise<void> {
	checkName(name);
	const directory = join(
		resolve(options.path ?? join(homedir(), ".agents", "skills")),
		name,
	);
	await mkdir(directory, { recursive: true });
	if ((await lstat(directory)).isSymbolicLink()) {
		throw new Error(`スキルの配置先がシンボリックリンクです: ${directory}`);
	}
	const destination = join(directory, "SKILL.md");
	const existing = await lstat(destination).catch(
		(error: NodeJS.ErrnoException) => {
			if (error.code !== "ENOENT") throw error;
			return undefined;
		},
	);
	if (existing) {
		if (!existing.isFile())
			throw new Error(`通常ファイルではありません: ${destination}`);
		if ((await readFile(destination, "utf8")) === discovery) {
			ui.success(`導入済みです: ${destination}`);
			return;
		}
		if (!options.force)
			throw new Error(
				`既存のスキルは変更しません: ${destination}。置き換える場合は --force を指定してください。`,
			);
	}
	if (!existing) {
		await writeFile(destination, discovery, { flag: "wx" });
	} else {
		const staging = await mkdtemp(join(directory, ".wts-install-"));
		try {
			const file = join(staging, "SKILL.md");
			await writeFile(file, discovery);
			await rename(file, destination);
		} finally {
			await rm(staging, { recursive: true, force: true });
		}
	}
	ui.success(`スキルをインストールしました: ${destination}`);
}
