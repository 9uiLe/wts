import { command, commandAsync } from "./process";

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

export function localBranches(git: Git): Map<string, string> {
	const refs = git.run([
		"for-each-ref",
		"--format=%(refname:strip=2)%00%(objectname)",
		"refs/heads/",
	]);
	return new Map(
		refs
			.split("\n")
			.filter(Boolean)
			.map((line) => {
				const [branch, oid] = line.split("\0");
				if (!branch || !oid) throw new Error("Git のブランチ情報が不正です。");
				return [branch, oid];
			}),
	);
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
