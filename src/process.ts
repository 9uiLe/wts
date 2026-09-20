export type CommandResult = { code: number; out: string; err: string };
type CommandIO = { inheritStdin?: boolean; inheritStderr?: boolean };

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
	io: CommandIO = {},
): CommandResult {
	requireCommand(executable);
	const result = Bun.spawnSync([executable, ...args], {
		cwd,
		stdin: io.inheritStdin
			? "inherit"
			: input === undefined
				? "ignore"
				: Buffer.from(input),
		stdout: "pipe",
		stderr: io.inheritStderr ? "inherit" : "pipe",
	});
	return {
		code: result.exitCode,
		out: result.stdout.toString(),
		err: result.stderr?.toString() ?? "",
	};
}

export async function commandAsync(
	executable: string,
	args: string[],
	cwd: string,
	input?: string,
	io: CommandIO = {},
): Promise<CommandResult> {
	requireCommand(executable);
	const result = Bun.spawn([executable, ...args], {
		cwd,
		stdin: io.inheritStdin
			? "inherit"
			: input === undefined
				? "ignore"
				: Buffer.from(input),
		stdout: "pipe",
		stderr: io.inheritStderr ? "inherit" : "pipe",
	});
	const [code, out, err] = await Promise.all([
		result.exited,
		new Response(result.stdout).text(),
		new Response(result.stderr).text(),
	]);
	return { code, out, err };
}

export function streamCommand(executable: string, args: string[]) {
	requireCommand(executable);
	return Bun.spawn([executable, ...args], {
		stdin: "pipe",
		stdout: "pipe",
		stderr: "inherit",
	});
}
