import {
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { ui } from "./ui";
function inside(root: string, path: string): boolean {
	const rel = relative(root, path);
	return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function safeDestination(root: string, path: string): void {
	if (!inside(root, path)) throw new Error("コピー先が worktree 外です");
	let current = path;
	while (inside(root, current)) {
		try {
			if (lstatSync(current).isSymbolicLink()) {
				throw new Error(`コピー先がシンボリックリンクです: ${current}`);
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		if (current === root) break;
		current = dirname(current);
	}
}

function copyPath(sourceRoot: string, targetRoot: string, rel: string): void {
	if (rel.split(sep).includes(".git"))
		throw new Error(".git はコピーできません");
	const source = resolve(sourceRoot, rel);
	const target = resolve(targetRoot, rel);
	if (!inside(sourceRoot, realpathSync(source))) {
		throw new Error("コピー元が指定ディレクトリ外です");
	}
	const stat = lstatSync(source);
	// ディレクトリの循環参照と、作成後に worktree 外を指すリンクを持ち込まない。
	if (stat.isSymbolicLink())
		throw new Error("シンボリックリンクはコピーできません");
	safeDestination(targetRoot, target);
	if (stat.isDirectory()) {
		mkdirSync(target, { recursive: true });
		for (const name of readdirSync(source)) {
			try {
				copyPath(sourceRoot, targetRoot, join(rel, name));
			} catch (error) {
				ui.warn(`コピーをスキップ: ${join(rel, name)}: ${String(error)}`);
			}
		}
	} else if (stat.isFile()) {
		mkdirSync(dirname(target), { recursive: true });
		copyFileSync(source, target);
	} else {
		throw new Error("通常のファイル・ディレクトリ以外はコピーできません");
	}
}

export function copyUnmanaged(
	list: string,
	source: string,
	target: string,
	dryRun: boolean,
): void {
	if (!existsSync(list)) return;
	let sourceRoot: string;
	try {
		sourceRoot = realpathSync(source);
	} catch (error) {
		ui.warn(`コピー元を参照できません: ${source}: ${String(error)}`);
		return;
	}
	for (const line of readFileSync(list, "utf8").split(/\r?\n/)) {
		const entry = (line.split("#")[0] ?? "").trim();
		if (!entry) continue;
		if (
			isAbsolute(entry) ||
			entry.includes("..") ||
			entry.split("/").includes(".git")
		) {
			ui.warn(`不正なエントリをスキップ: ${entry}`);
			continue;
		}
		try {
			const matches = new Bun.Glob(entry.replace(/\/$/, "")).scanSync({
				cwd: sourceRoot,
				dot: true,
				onlyFiles: false,
				followSymlinks: false,
			});
			for (const rel of matches) {
				try {
					if (dryRun) ui.plan(`コピー (dry-run): ${rel}`);
					else {
						copyPath(sourceRoot, target, rel);
						ui.info(`コピー: ${rel}`);
					}
				} catch (error) {
					ui.warn(`コピーをスキップ: ${rel}: ${String(error)}`);
				}
			}
		} catch (error) {
			ui.warn(`コピーに失敗しました: ${entry}: ${String(error)}`);
		}
	}
}
