import {
	copyFileSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { isSameOrDescendant } from "./path";
import { ui } from "./ui";

export function readCopyList(list: string): string[] {
	try {
		return readFileSync(list, "utf8")
			.split(/\r?\n/)
			.map((line) => (line.split("#")[0] ?? "").trim())
			.filter(Boolean);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			try {
				lstatSync(list);
			} catch (missing) {
				if ((missing as NodeJS.ErrnoException).code === "ENOENT") return [];
			}
		}
		throw new Error(`コピーリストを読み込めません: ${list}`, { cause: error });
	}
}

function requireUnlinkedPath(root: string, path: string): void {
	if (!isSameOrDescendant(path, root))
		throw new Error("コピー先が worktree 外です");
	let current = path;
	while (isSameOrDescendant(current, root)) {
		try {
			if (lstatSync(current).isSymbolicLink()) {
				throw new Error(`シンボリックリンクはコピーできません: ${current}`);
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		if (current === root) break;
		current = dirname(current);
	}
}

type CopyItem = { kind: "file" | "directory"; rel: string };
type CopyEntry =
	| CopyItem
	| { kind: "rejected"; rel: string; diagnostic: string };

function inspectCopyPath(
	source: string,
	target: string,
	rel: string,
): CopyItem {
	if (rel.split(sep).includes(".git"))
		throw new Error(".git はコピーできません");
	const from = resolve(source, rel);
	if (!isSameOrDescendant(from, source))
		throw new Error("コピー元が指定ディレクトリ外です");
	requireUnlinkedPath(source, from);
	if (!isSameOrDescendant(realpathSync(from), source))
		throw new Error("コピー元が指定ディレクトリ外です");
	requireUnlinkedPath(target, resolve(target, rel));
	const stat = lstatSync(from);
	if (!stat.isFile() && !stat.isDirectory())
		throw new Error("通常のファイル・ディレクトリ以外はコピーできません");
	return { rel, kind: stat.isDirectory() ? "directory" : "file" };
}

function scanCopy(
	entries: string[],
	source: string,
	target: string,
): CopyEntry[] {
	const result: CopyEntry[] = [];
	const seen = new Set<string>();
	function visit(rel: string): void {
		if (seen.has(rel)) return;
		seen.add(rel);
		try {
			const item = inspectCopyPath(source, target, rel);
			result.push(item);
			if (item.kind === "directory") {
				for (const name of readdirSync(resolve(source, rel)))
					visit(join(rel, name));
			}
		} catch (error) {
			result.push({ kind: "rejected", rel, diagnostic: String(error) });
		}
	}
	for (const entry of entries) {
		if (
			isAbsolute(entry) ||
			entry.split(/[\\/]/).includes("..") ||
			entry.split("/").includes(".git")
		) {
			result.push({
				kind: "rejected",
				rel: entry,
				diagnostic: "不正なエントリ",
			});
			continue;
		}
		try {
			for (const rel of new Bun.Glob(entry.replace(/\/$/, "")).scanSync({
				cwd: source,
				dot: true,
				onlyFiles: false,
				followSymlinks: false,
			}))
				visit(rel);
		} catch (error) {
			result.push({ kind: "rejected", rel: entry, diagnostic: String(error) });
		}
	}
	return result;
}

function writeCopyItem(item: CopyItem, source: string, target: string): void {
	const destination = resolve(target, item.rel);
	requireUnlinkedPath(resolve(target), destination);
	if (item.kind === "directory") mkdirSync(destination, { recursive: true });
	else {
		mkdirSync(dirname(destination), { recursive: true });
		requireUnlinkedPath(resolve(target), destination);
		copyFileSync(resolve(source, item.rel), destination);
	}
}

export function copyUnmanaged(
	entries: string[],
	source: string,
	target: string,
	dryRun: boolean,
): void {
	if (!entries.length) return;
	let sourceRoot: string;
	try {
		sourceRoot = realpathSync(source);
	} catch (error) {
		ui.warn(`コピー元を参照できません: ${source}: ${String(error)}`);
		return;
	}
	for (const item of scanCopy(entries, sourceRoot, resolve(target))) {
		if (item.kind === "rejected") {
			ui.warn(
				`${dryRun ? "本実行で拒否" : "コピーをスキップ"}: ${item.rel}: ${item.diagnostic}`,
			);
			continue;
		}
		if (dryRun) {
			ui.plan(`コピー (dry-run): ${item.rel}`);
			continue;
		}
		try {
			writeCopyItem(item, sourceRoot, resolve(target));
			ui.info(`コピー: ${item.rel}`);
		} catch (error) {
			ui.warn(`コピーをスキップ: ${item.rel}: ${String(error)}`);
		}
	}
}
