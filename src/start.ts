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
import {
	defaultNaming,
	generateName,
	validateBranchName,
	validateWorktreeName,
} from "./naming";
import {
	askText,
	ensureClean,
	fetchBase,
	recordSession,
	repository,
	sessionRootBranch,
	stackBranches,
	validateRef,
	worktrees,
} from "./session";

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
				console.warn(`コピーをスキップ: ${join(rel, name)}: ${String(error)}`);
			}
		}
	} else if (stat.isFile()) {
		mkdirSync(dirname(target), { recursive: true });
		copyFileSync(source, target);
	} else {
		throw new Error("通常のファイル・ディレクトリ以外はコピーできません");
	}
}

function copyUnmanaged(
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
		console.warn(`コピー元を参照できません: ${source}: ${String(error)}`);
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
			console.warn(`不正なエントリをスキップ: ${entry}`);
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
					console.log(`コピー${dryRun ? " (dry-run)" : ""}: ${rel}`);
					if (!dryRun) copyPath(sourceRoot, target, rel);
				} catch (error) {
					console.warn(`コピーをスキップ: ${rel}: ${String(error)}`);
				}
			}
		} catch (error) {
			console.warn(`コピーに失敗しました: ${entry}: ${String(error)}`);
		}
	}
}

export async function startWorktreeSession(options: {
	dryRun?: boolean;
	task?: string;
	baseBranch?: string;
	copyFrom?: string;
}): Promise<void> {
	const repo = await repository();
	const task =
		options.task ??
		(repo.config.config.naming?.branch || repo.config.config.naming?.worktree
			? await askText("作業内容 (Enter でスキップ)")
			: "");
	const base =
		options.baseBranch || (await askText("ベースブランチ", "origin/main"));
	validateRef(base);
	const naming = defaultNaming();
	const branch = generateName(repo.config, { ...naming, kind: "branch", task });
	validateBranchName(repo.git, branch);
	const worktree = generateName(repo.config, {
		...naming,
		kind: "worktree",
		task,
		branch,
		defaultName: branch.replaceAll("/", "-"),
	});
	validateWorktreeName(worktree);
	const target = join(repo.worktreesBase, worktree);
	try {
		lstatSync(target);
		throw new Error(`Worktree の作成先は既に存在します: ${target}`);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	if (worktrees(repo.git).some((wt) => wt.path === target))
		throw new Error(`Worktree は既に登録されています: ${target}`);
	const dryRun = options.dryRun ?? false;
	fetchBase(repo.git, base, dryRun);
	const source = options.copyFrom
		? resolve(repo.root, options.copyFrom)
		: (!base.startsWith("origin/") &&
				worktrees(repo.git).find((wt) => wt.branch === base)?.path) ||
			repo.main;
	if (dryRun) {
		console.log(`dry-run: git worktree add -b ${branch} ${target} ${base}`);
	} else {
		mkdirSync(repo.worktreesBase, { recursive: true });
		repo.git.run(["worktree", "add", "-b", branch, target, base]);
		recordSession(repo.git, target, branch);
	}
	copyUnmanaged(join(repo.root, ".worktree-copy"), source, target, dryRun);
	console.log(
		`Worktree 準備完了${dryRun ? " (dry-run)" : ""}\nBranch  ${branch}\nPath    ${target}`,
	);
}

export async function startStackBranch(options: {
	dryRun?: boolean;
	task?: string;
	prNumber?: string;
}): Promise<void> {
	const repo = await repository();
	const root = sessionRootBranch(repo);
	ensureClean(repo.git);
	const branches = stackBranches(repo.git, root);
	const tip = branches.at(-1);
	if (!tip) throw new Error(`スタックの root ブランチが存在しません: ${root}`);
	const current = repo.git.run(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
	if (current !== tip.branch) {
		throw new Error(
			`現在のブランチ ${current} はスタックの先端ではありません。${tip.branch} に切り替えてください`,
		);
	}
	const task =
		options.task ??
		(repo.config.config.naming?.branch
			? await askText("作業内容 (Enter でスキップ)")
			: "");
	const number =
		options.prNumber || (await askText("PR 番号", String(tip.number + 1n)));
	if (!/^\d+$/.test(number) || BigInt(number) < 2n) {
		throw new Error(
			`不正な PR 番号: ${number}。2 以上の整数を指定してください`,
		);
	}
	if (branches.some((branch) => branch.number === BigInt(number))) {
		throw new Error(`PR 番号 ${number} は既に使われています`);
	}
	const suffix = generateName(repo.config, {
		...defaultNaming(),
		kind: "branch",
		task,
		rootBranch: root,
		prNumber: number,
	});
	const branch = `${root}-pr${number}-${suffix}`;
	validateBranchName(repo.git, branch);
	if (options.dryRun) {
		console.log(`dry-run: git checkout -b ${branch}`);
	} else {
		repo.git.run(["checkout", "-b", branch]);
	}
	console.log(
		`スタックブランチ準備完了${options.dryRun ? " (dry-run)" : ""}\nBranch  ${branch}`,
	);
}
