import { realpathSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { cancel, confirm, isCancel, text } from "@clack/prompts";

export class Cancelled extends Error {}

export function requireCommand(name: string): void {
	if (!Bun.which(name))
		throw new Error(
			`${name} コマンドが見つかりません。PATH を確認してください。`,
		);
}

export function command(
	executable: string,
	args: string[],
	cwd: string,
	input?: string,
): { code: number; out: string; err: string } {
	requireCommand(executable);
	const result = Bun.spawnSync([executable, ...args], {
		cwd,
		stdin: input === undefined ? "ignore" : Buffer.from(input),
		stdout: "pipe",
		stderr: "pipe",
	});
	return {
		code: result.exitCode,
		out: result.stdout.toString().trimEnd(),
		err: result.stderr.toString().trimEnd(),
	};
}

export class Git {
	constructor(public cwd: string = process.cwd()) {}
	tryRun(args: string[], input?: string) {
		return command("git", args, this.cwd, input);
	}
	run(args: string[], input?: string): string {
		const result = this.tryRun(args, input);
		if (result.code !== 0)
			throw new Error(`git ${args[0]} に失敗しました。\n${result.err}`);
		return result.out;
	}
}

export async function repository() {
	const initial = new Git();
	const root = realpathSync(initial.run(["rev-parse", "--show-toplevel"]));
	const git = new Git(root);
	const common = realpathSync(
		resolve(root, git.run(["rev-parse", "--git-common-dir"])),
	);
	const main = dirname(common);
	const gitDir = realpathSync(
		resolve(root, git.run(["rev-parse", "--git-dir"])),
	);
	return { git, root, main, worktreesBase: `${main}-worktrees`, gitDir };
}

export function worktrees(git: Git): { path: string; branch: string }[] {
	return git
		.run(["worktree", "list", "--porcelain", "-z"])
		.split("\0\0")
		.filter(Boolean)
		.map((block) => {
			const fields = block.split("\0");
			return {
				path:
					fields.find((line) => line.startsWith("worktree "))?.slice(9) ?? "",
				branch:
					fields
						.find((line) => line.startsWith("branch refs/heads/"))
						?.slice(18) ?? "",
			};
		});
}

export function sessionRoot(repo: {
	root: string;
	worktreesBase: string;
}): string {
	const path = relative(repo.worktreesBase, repo.root);
	if (
		!path ||
		path === ".." ||
		path.startsWith(`..${sep}`) ||
		path.startsWith(sep)
	)
		throw new Error(
			`この worktree は ${repo.worktreesBase} 配下ではありません。`,
		);
	return path.split(sep)[0] as string;
}

export function stackBranches(
	git: Git,
	rootBranch: string,
): { branch: string; number: bigint }[] {
	const prefix = `${rootBranch}-pr`;
	const members = git
		.run(["for-each-ref", "--format=%(refname:short)", "refs/heads/"])
		.split("\n")
		.flatMap((branch) => {
			if (!branch.startsWith(prefix)) return [];
			const match = /^(\d+)-/.exec(branch.slice(prefix.length));
			return match ? [{ branch, number: BigInt(match[1] as string) }] : [];
		});
	members.sort((a, b) =>
		a.number < b.number
			? -1
			: a.number > b.number
				? 1
				: a.branch.localeCompare(b.branch),
	);
	return [{ branch: rootBranch, number: 1n }, ...members];
}

export function ensureClean(git: Git): void {
	if (git.run(["status", "--porcelain"]))
		throw new Error(
			"作業ツリーがクリーンではありません。コミットまたは stash してください。",
		);
}

export function validateRef(ref: string): void {
	if (!ref || ref.startsWith("-") || /[\0\r\n]/.test(ref))
		throw new Error(`不正なベースブランチ: ${ref}`);
}

export function fetchBase(git: Git, base: string, dryRun: boolean): void {
	validateRef(base);
	if (!dryRun && base.startsWith("origin/")) {
		const result = git.tryRun(["fetch", "--", "origin", base.slice(7)]);
		if (result.code !== 0)
			console.warn(
				`${base} の fetch に失敗しました。ローカルの参照を使用します。`,
			);
	}
	if (
		git.tryRun(["rev-parse", "--verify", "--quiet", `${base}^{commit}`])
			.code !== 0
	)
		throw new Error(`ベースブランチ ${base} が見つかりません。`);
}

function requireTTY(): void {
	if (!process.stdin.isTTY || !process.stdout.isTTY)
		throw new Error(
			"対話入力には TTY 端末が必要です。オプションで値を指定してください。",
		);
}

export async function askText(
	message: string,
	defaultValue = "",
): Promise<string> {
	requireTTY();
	const answer = await text({
		message,
		placeholder: defaultValue,
		defaultValue,
	});
	if (isCancel(answer)) {
		cancel("キャンセルしました。");
		throw new Cancelled();
	}
	return answer || defaultValue;
}

export async function confirmAction(message: string): Promise<boolean> {
	requireTTY();
	const answer = await confirm({ message, initialValue: false });
	if (isCancel(answer) || !answer) {
		cancel("キャンセルしました。");
		return false;
	}
	return true;
}
