import { command, commandAsync } from "./process";
import { ui } from "./ui";

export class Git {
	constructor(public cwd: string = process.cwd()) {}
	tryRun(args: string[], input?: string) {
		const result = command("git", args, this.cwd, input);
		return { ...result, out: result.out.trimEnd(), err: result.err.trimEnd() };
	}
	async tryRunAsync(args: string[], input?: string) {
		const result = await commandAsync("git", args, this.cwd, input);
		return { ...result, out: result.out.trimEnd(), err: result.err.trimEnd() };
	}
	async runAsync(args: string[], input?: string): Promise<string> {
		const result = await this.tryRunAsync(args, input);
		if (result.code !== 0)
			throw new Error(`git ${args[0]} に失敗しました。\n${result.err}`);
		return result.out;
	}
	run(args: string[], input?: string): string {
		const result = this.tryRun(args, input);
		if (result.code !== 0)
			throw new Error(`git ${args[0]} に失敗しました。\n${result.err}`);
		return result.out;
	}
}

export function worktrees(
	git: Git,
): { path: string; branch: string; locked: boolean }[] {
	return git
		.run(["worktree", "list", "--porcelain", "-z"])
		.split("\0\0")
		.filter(Boolean)
		.map((block) => {
			const fields = block.split("\0");
			return {
				locked: fields.some((field) => /^locked(?: |$)/.test(field)),
				path:
					fields.find((line) => line.startsWith("worktree "))?.slice(9) ?? "",
				branch:
					fields
						.find((line) => line.startsWith("branch refs/heads/"))
						?.slice(18) ?? "",
			};
		});
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

export async function fetchBase(
	git: Git,
	base: string,
	dryRun: boolean,
): Promise<void> {
	validateRef(base);
	if (!dryRun && base.startsWith("origin/")) {
		const result = await ui.task(`${base} を取得しています`, () =>
			git.tryRunAsync(["fetch", "--", "origin", base.slice(7)]),
		);
		if (result.code !== 0)
			ui.warn(`${base} の fetch に失敗しました。ローカルの参照を使用します。`);
	}
	if (
		git.tryRun(["rev-parse", "--verify", "--quiet", `${base}^{commit}`])
			.code !== 0
	)
		throw new Error(`ベースブランチ ${base} が見つかりません。`);
}

export function dirtyStatus(git: Git): string {
	return git.run([
		"--no-optional-locks",
		"status",
		"--porcelain=v1",
		"-z",
		"--untracked-files=all",
		"--ignored",
	]);
}
