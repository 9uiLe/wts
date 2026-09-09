import {
	accessSync,
	constants,
	lstatSync,
	readFileSync,
	realpathSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { isSameOrDescendant } from "./path";
import { Git } from "./git";

export type NamingRule = { script: string; prompt?: string };
export type ProjectConfig = {
	baseBranch?: string;
	worktreeDirectory?: string;
	naming?: { branch?: NamingRule; worktree?: NamingRule };
};
export type LoadedConfig = {
	config: ProjectConfig;
	path: string;
	directory: string;
	worktreesBase: string;
};

function object(value: unknown, key: string, allowed: string[]) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${key} はオブジェクトで指定してください。`);
	}
	for (const name of Object.keys(value)) {
		if (!allowed.includes(name))
			throw new Error(`不明な設定キー: ${key}.${name}`);
	}
	return value as Record<string, unknown>;
}

function string(value: unknown, key: string, path = false): string {
	if (typeof value !== "string")
		throw new Error(`${key} は文字列で指定してください。`);
	if (value.includes("\0")) throw new Error(`${key} に NUL は使用できません。`);
	if (path && !value.trim())
		throw new Error(`${key} に空のパスは指定できません。`);
	return value;
}

function present(path: string): boolean {
	try {
		lstatSync(path);
		return true;
	} catch (error) {
		if (
			["ENOENT", "ENOTDIR"].includes(
				(error as NodeJS.ErrnoException).code ?? "",
			)
		)
			return false;
		throw new Error(`パスを確認できません: ${path}`, { cause: error });
	}
}

function namingRule(
	value: unknown,
	key: string,
	directory: string,
): NamingRule {
	const data = object(value, key, ["script", "prompt"]);
	const script = resolve(directory, string(data.script, `${key}.script`, true));
	try {
		if (!statSync(script).isFile())
			throw new Error("通常のファイルではありません");
		accessSync(script, constants.X_OK);
	} catch (error) {
		throw new Error(
			`${key}.script は実在する実行可能ファイルを指定してください: ${script}`,
			{ cause: error },
		);
	}
	const rule: NamingRule = { script: realpathSync(script) };
	if ("prompt" in data) rule.prompt = string(data.prompt, `${key}.prompt`);
	return rule;
}

function baseBranch(value: unknown, directory: string): string {
	const branch = string(value, "baseBranch");
	if (
		!branch ||
		branch.startsWith("-") ||
		branch === "HEAD" ||
		new Git(directory).tryRun(["check-ref-format", `refs/heads/${branch}`])
			.code !== 0
	)
		throw new Error("baseBranch は有効な Git ブランチ名で指定してください。");
	return branch;
}

function parse(data: unknown, directory: string): ProjectConfig {
	const value = object(data, ".wts.json", [
		"baseBranch",
		"worktreeDirectory",
		"naming",
	]);
	const config: ProjectConfig = {};
	if ("baseBranch" in value)
		config.baseBranch = baseBranch(value.baseBranch, directory);
	if ("worktreeDirectory" in value) {
		config.worktreeDirectory = string(
			value.worktreeDirectory,
			"worktreeDirectory",
			true,
		);
	}
	if ("naming" in value) {
		const naming = object(value.naming, "naming", ["branch", "worktree"]);
		config.naming = {};
		if ("branch" in naming)
			config.naming.branch = namingRule(
				naming.branch,
				"naming.branch",
				directory,
			);
		if ("worktree" in naming)
			config.naming.worktree = namingRule(
				naming.worktree,
				"naming.worktree",
				directory,
			);
	}
	return config;
}

function canonicalDestination(path: string): string {
	let ancestor = path;
	while (!present(ancestor)) ancestor = dirname(ancestor);
	try {
		if (!statSync(ancestor).isDirectory())
			throw new Error("通常のディレクトリではありません");
		accessSync(ancestor, constants.W_OK | constants.X_OK);
		return resolve(realpathSync(ancestor), relative(ancestor, path));
	} catch (error) {
		throw new Error(
			`worktreeDirectory の既存の親は書き込み可能なディレクトリである必要があります: ${ancestor}`,
			{ cause: error },
		);
	}
}

function gitMetadata(directory: string): string[] {
	const entry = join(directory, ".git");
	if (!present(entry)) return [entry];
	if (statSync(entry).isDirectory()) return [entry, realpathSync(entry)];
	const match = /^gitdir: (.+)\s*$/m.exec(readFileSync(entry, "utf8"));
	if (!match?.[1]) return [entry];
	const target = resolve(directory, match[1].trim());
	return [entry, present(target) ? realpathSync(target) : target];
}

function loaded(
	config: ProjectConfig,
	path: string,
	directory: string,
	main: string,
): LoadedConfig {
	const canonicalMain = realpathSync(main);
	const worktreesBase = canonicalDestination(
		resolve(
			canonicalMain,
			config.worktreeDirectory ?? `${canonicalMain}-worktrees`,
		),
	);
	if (worktreesBase === canonicalMain)
		throw new Error(
			"worktreeDirectory にメインリポジトリそのものは指定できません。",
		);
	if (
		[...gitMetadata(canonicalMain), ...gitMetadata(directory)].some(
			(metadata) => isSameOrDescendant(worktreesBase, metadata),
		)
	) {
		throw new Error(
			"worktreeDirectory に .git 管理情報の配下は指定できません。",
		);
	}
	return { config, path, directory, worktreesBase };
}

export function loadConfigFile(
	file: string,
	main = dirname(resolve(file)),
): LoadedConfig {
	const path = resolve(file);
	const directory = dirname(path);
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch (error) {
		throw new Error(`設定ファイルを読み込めません: ${path}`, { cause: error });
	}
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch (error) {
		throw new Error(`設定ファイルの JSON 構文が不正です: ${path}`, {
			cause: error,
		});
	}
	return loaded(parse(data, directory), path, directory, main);
}

export function loadProjectConfig(root: string, main: string): LoadedConfig {
	for (const directory of new Set([resolve(root), resolve(main)])) {
		const path = join(directory, ".wts.json");
		if (present(path)) return loadConfigFile(path, main);
	}
	throw new Error(".wts.json がありません。wts init を実行してください。");
}

export function initializeConfig(
	root: string,
	main: string,
	base?: string,
): string {
	const path = join(root, ".wts.json");
	const config: ProjectConfig = {
		worktreeDirectory: `../${basename(main)}-worktrees`,
		naming: {},
	};
	if (base !== undefined) config.baseBranch = baseBranch(base, root);
	try {
		writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { flag: "wx" });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			throw new Error(`初期化済みです。既存の設定を確認してください: ${path}`);
		}
		throw new Error(`設定ファイルを作成できません: ${path}`, { cause: error });
	}
	return path;
}
