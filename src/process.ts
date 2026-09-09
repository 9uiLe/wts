export type CommandResult = { code: number; out: string; err: string };

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
): CommandResult {
	requireCommand(executable);
	const result = Bun.spawnSync([executable, ...args], {
		cwd,
		stdin: input === undefined ? "ignore" : Buffer.from(input),
		stdout: "pipe",
		stderr: "pipe",
	});
	return {
		code: result.exitCode,
		out: result.stdout.toString(),
		err: result.stderr.toString(),
	};
}

export async function commandAsync(
	executable: string,
	args: string[],
	cwd: string,
	input?: string,
): Promise<CommandResult> {
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
	return { code, out, err };
}
