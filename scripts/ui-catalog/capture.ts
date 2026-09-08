import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface Capture {
	title: string;
	args: string[];
	command: string;
	cwd: string;
	code: number;
	raw: string;
	frames: string[];
	mode: string;
	input: Array<[string, string]>;
}

const gitPath = Bun.which("git");
if (!gitPath) throw new Error("UI 一覧の収録には Git が必要です。");

export const context = {
	root: realpathSync(mkdtempSync(join(tmpdir(), "wts-ui-catalog-"))),
	cli: resolve(import.meta.dir, "../../src/cli.ts"),
	bun: process.execPath,
	gitPath,
};

const fixtureEnv: Record<string, string | undefined> = {
	...process.env,
	PATH: `${dirname(gitPath)}:/usr/bin:/bin`,
	TERM: "xterm-256color",
	FORCE_COLOR: "1",
	CI: undefined,
	NO_COLOR: undefined,
	DRY_RUN: undefined,
	BASE_BRANCH: undefined,
	COPY_FROM: undefined,
	PR_NUMBER: undefined,
	PUSH: undefined,
	PUSH_ONLY: undefined,
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_TERMINAL_PROMPT: "0",
};

export function git(cwd: string, ...args: string[]): string {
	const result = Bun.spawnSync([context.gitPath, "-C", cwd, ...args], {
		env: fixtureEnv,
	});
	if (result.exitCode !== 0)
		throw new Error(
			`Git fixture ${args.join(" ")}: ${result.stderr.toString()}`,
		);
	return result.stdout.toString().trim();
}

export function fixture(name: string): string {
	const directory = join(context.root, name);
	const repo = join(directory, "repo");
	mkdirSync(repo, { recursive: true });
	git(repo, "init", "-b", "main");
	git(repo, "config", "user.name", "Terminal Preview");
	git(repo, "config", "user.email", "preview@example.invalid");
	writeFileSync(join(repo, ".wts.json"), "{}\n");
	writeFileSync(join(repo, "tracked"), "initial\n");
	git(repo, "add", ".");
	git(repo, "commit", "-m", "initial");
	const origin = join(directory, "origin.git");
	git(directory, "init", "--bare", origin);
	git(repo, "remote", "add", "origin", origin);
	git(repo, "push", "-u", "origin", "main");
	return repo;
}

export async function capture(
	title: string,
	args: string[],
	cwd: string,
	options: {
		steps?: Array<[string, string]>;
		env?: Record<string, string | undefined>;
		pipe?: boolean;
		command?: string[];
	} = {},
): Promise<Capture> {
	const command = options.command ?? [context.bun, context.cli, ...args];
	const env = { ...fixtureEnv, ...options.env };
	const frames: string[] = [];
	const steps = options.steps ?? [];
	let raw = "";
	let code: number;
	let consumed = 0;
	if (options.pipe) {
		const child = Bun.spawn(command, {
			cwd,
			env,
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		});
		const [status, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		code = status;
		raw = stdout + stderr;
	} else {
		const decoder = new TextDecoder();
		const closed = Promise.withResolvers<void>();
		let matchingFrom = 0;
		let scheduled = false;
		let interactionFailure: Error | undefined;
		const child = Bun.spawn(command, {
			cwd,
			env,
			terminal: {
				// 収録条件を固定し、端末サイズによる折り返しを比較に混在させない。
				cols: 120,
				rows: 40,
				data(terminal, data) {
					raw += decoder.decode(data, { stream: true });
					if (!scheduled) {
						scheduled = true;
						setImmediate(() => {
							scheduled = false;
							if (terminal.closed) return;
							const next = steps[consumed];
							const pending = raw.slice(matchingFrom);
							const plain = Bun.stripANSI(pending);
							if (next && plain.includes(next[0])) {
								frames.push(raw);
								matchingFrom = raw.length;
								consumed++;
								terminal.write(next[1]);
							} else if (
								raw.lastIndexOf("\u001b[?25l") >
									raw.lastIndexOf("\u001b[?25h") &&
								plain.includes("◆") &&
								plain.includes("└")
							) {
								interactionFailure = new Error(
									`${title}: 未定義の対話です。期待: ${next?.[0] ?? "入力なし"}\n${plain}`,
								);
								child.kill();
							}
						});
					}
				},
				exit() {
					closed.resolve();
				},
			},
		});
		try {
			[code] = await Promise.all([child.exited, closed.promise]);
			raw += decoder.decode();
		} finally {
			child.terminal?.close();
			if (child.exitCode === null) child.kill();
		}
		if (interactionFailure) throw interactionFailure;
	}
	if (consumed !== steps.length)
		throw new Error(
			`${title}: 入力 ${consumed}/${steps.length} 件のみ消化しました。\n${Bun.stripANSI(raw)}`,
		);
	if (code !== 0 && code !== 1)
		throw new Error(
			`${title}: 収録対象の通常終了・エラー終了以外のコード ${code}\n${Bun.stripANSI(raw)}`,
		);
	return {
		title,
		args,
		command: `wts ${args.map((arg) => (/^[\w./:=@-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`)).join(" ")}`,
		cwd,
		code,
		raw,
		frames,
		mode: options.pipe ? "PIPE 実測" : "TTY 実測",
		input: steps,
	};
}
