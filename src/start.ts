import {
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	realpathSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
	askText,
	command,
	ensureClean,
	fetchBase,
	repository,
	sessionRoot,
	stackBranches,
	validateRef,
	worktrees,
} from "./session";

function timestamp(): { date: string; time: string } {
	const parts = new Intl.DateTimeFormat("en-GB", {
		timeZone: "Asia/Tokyo",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	}).formatToParts(new Date());
	const value = (type: string) =>
		parts.find((part) => part.type === type)?.value;
	return {
		date: `${value("year")}${value("month")}${value("day")}`,
		time: `${value("hour")}${value("minute")}${value("second")}`,
	};
}

function slug(task: string, cwd: string): string {
	if (!task) return "";
	try {
		const result = command(
			"claude",
			[
				"-p",
				"--model",
				"haiku",
				`以下のタスク説明から、git ブランチ名に適した英語のスラッグを生成してください。
ルール:
- 英小文字とハイフンのみ使用
- 50文字以内
- スラッグのみを出力（説明や装飾は不要）
- 情報が不足していても質問や確認をせず、与えられた文字列だけから推測して出力する
- 例: add-notification-banner, fix-login-crash, refactor-auth-module

タスク: ${task}`,
			],
			cwd,
		);
		if (result.code !== 0) return "";
		const candidate = (
			result.out.split(/\r?\n/).find((line) => line.trim()) ?? ""
		)
			.trim()
			.replace(/[`"']/g, "")
			.toLowerCase()
			.replace(/[.。]+$/, "");
		return candidate.length <= 50 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(candidate)
			? candidate
			: "";
	} catch {
		return "";
	}
}

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
	const { date, time } = timestamp();
	const task = options.task ?? (await askText("作業内容 (Enter でスキップ)"));
	const base =
		options.baseBranch || (await askText("ベースブランチ", "origin/main"));
	validateRef(base);
	const branch = `${date}-${slug(task, repo.root) || time}`;
	const target = join(repo.worktreesBase, branch);
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
	const root = sessionRoot(repo);
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
	const task = options.task ?? (await askText("作業内容 (Enter でスキップ)"));
	const suffix = slug(task, repo.root) || timestamp().time;
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
	const branch = `${root}-pr${number}-${suffix}`;
	if (options.dryRun) {
		console.log(`dry-run: git checkout -b ${branch}`);
	} else {
		repo.git.run(["checkout", "-b", branch]);
	}
	console.log(
		`スタックブランチ準備完了${options.dryRun ? " (dry-run)" : ""}\nBranch  ${branch}`,
	);
}
