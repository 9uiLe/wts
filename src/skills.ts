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
import { dirname, join, resolve } from "node:path";
import entrypoint from "../skills/wts-cli/SKILL.md" with { type: "text" };
import guide from "../skills/wts-cli/references/guide.md" with { type: "text" };

const bundledSkill = { name: "wts-cli", entrypoint, guide };

function requireSkill(name: string) {
	if (name !== bundledSkill.name) {
		throw new Error(`未知のスキル: ${name}（利用可能: ${bundledSkill.name}）`);
	}
	return bundledSkill;
}

export function getSkillGuide(name: string): string {
	return requireSkill(name).guide;
}

async function readInstalledEntrypoint(
	path: string,
): Promise<string | undefined> {
	const entry = await lstat(path).catch((error: NodeJS.ErrnoException) => {
		if (error.code !== "ENOENT") throw error;
		return undefined;
	});
	if (!entry) return undefined;
	if (!entry.isFile()) throw new Error(`通常ファイルではありません: ${path}`);
	return readFile(path, "utf8");
}

async function replaceEntrypoint(
	path: string,
	contents: string,
): Promise<void> {
	const stagingDirectory = await mkdtemp(join(dirname(path), ".wts-install-"));
	try {
		const stagedEntrypoint = join(stagingDirectory, "SKILL.md");
		await writeFile(stagedEntrypoint, contents);
		await rename(stagedEntrypoint, path);
	} finally {
		await rm(stagingDirectory, { recursive: true, force: true });
	}
}

export async function installSkillFiles(
	name: string,
	options: { path?: string; force?: boolean },
): Promise<{ path: string; changed: boolean }> {
	const skill = requireSkill(name);
	const skillsDirectory = resolve(
		options.path ?? join(homedir(), ".agents", "skills"),
	);
	const skillDirectory = join(skillsDirectory, skill.name);
	await mkdir(skillDirectory, { recursive: true });
	if ((await lstat(skillDirectory)).isSymbolicLink()) {
		throw new Error(
			`スキルの配置先がシンボリックリンクです: ${skillDirectory}`,
		);
	}
	const path = join(skillDirectory, "SKILL.md");
	const installed = await readInstalledEntrypoint(path);
	if (installed === skill.entrypoint) return { path, changed: false };
	if (installed === undefined) {
		await writeFile(path, skill.entrypoint, { flag: "wx" });
	} else {
		if (!options.force) {
			throw new Error(
				`既存のスキルは変更しません: ${path}。置き換える場合は --force を指定してください。`,
			);
		}
		await replaceEntrypoint(path, skill.entrypoint);
	}
	return { path, changed: true };
}
