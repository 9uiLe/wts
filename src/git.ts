import { ui } from "./ui";

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

export async function commandAsync(
	executable: string,
	args: string[],
	cwd: string,
	input?: string,
): Promise<{ code: number; out: string; err: string }> {
	requireCommand(executable);
	const result = Bun.spawn([executable, ...args], {
		cwd,
		stdin: input === undefined ? "ignore" : Buffer.from(input),
		stdout: "pipe",
		stderr: "pipe",
	});
	const [code, out, err] = await Promise.all([
		result.exited,
		new Response(result.stdout).text(),
		new Response(result.stderr).text(),
	]);
	return { code, out: out.trimEnd(), err: err.trimEnd() };
}

export class Git {
	constructor(public cwd: string = process.cwd()) {}
	tryRun(args: string[], input?: string) {
		return command("git", args, this.cwd, input);
	}
	tryRunAsync(args: string[], input?: string) {
		return commandAsync("git", args, this.cwd, input);
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
