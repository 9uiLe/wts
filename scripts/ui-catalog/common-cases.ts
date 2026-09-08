import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Capture, capture, context } from "./capture";

type Options = Parameters<typeof capture>[3];

export async function commonCases(): Promise<Capture[]> {
	const items: Capture[] = [];
	const take = async (
		title: string,
		args: string[],
		cwd = context.root,
		expected = 1,
		options?: Options,
	) => {
		const result = await capture(title, args, cwd, options);
		if (result.code !== expected)
			throw new Error(
				`${title}: expected exit ${expected}, got ${result.code}\n${result.raw}`,
			);
		items.push(result);
	};
	const helpArgs = [
		[],
		["--help"],
		["--version"],
		["help"],
		["help", "start"],
		["config"],
		["config", "check", "--help"],
		...["doctor", "init", "config", "start", "stack", "cleanup", "restack"].map(
			(x) => [x, "--help"],
		),
	];
	for (const args of helpArgs)
		await take(
			`ヘルプ / バージョン: ${args.join(" ")}`,
			args,
			context.root,
			args.length === 0 || (args.length === 1 && args[0] === "config") ? 1 : 0,
		);
	for (const args of [
		["unknown"],
		["strt"],
		["--unknown"],
		["start", "--unknown"],
		["start", "--task"],
		["stack", "--pr-number"],
		["restack", "--base-branch"],
		["start", "--copy-from"],
		["doctor", "extra"],
		["config", "unknown"],
		["config", "check", "one", "two"],
		["doctor", "--interactive", "--check"],
	] as const)
		await take(`引数エラー: ${args.join(" ")}`, [...args]);
	await take("doctor 通常", ["doctor"], context.root, 0);
	for (const [title, keys] of [
		["肯定", "\r"],
		["否定", "\u001b[C\r"],
		["Ctrl-C", "\u0003"],
	] as const)
		await take(
			`doctor 対話 ${title}`,
			["doctor", "--interactive"],
			context.root,
			0,
			{ steps: [["起動環境を表示しますか？", keys]] },
		);
	await take(
		"doctor 対話 / 非TTY",
		["doctor", "--interactive"],
		context.root,
		1,
		{ pipe: true },
	);
	const doctorModes: Array<[string, string | null, boolean, boolean, boolean]> =
		[
			["all-ok", "2.38.0", true, true, true],
			["missing", null, false, false, false],
			["old-git", "2.37.0", true, true, false],
			["auth-failed", "2.38.0", true, false, false],
			["optional-missing", "2.38.0", true, true, false],
			["invalid-git", "invalid", true, true, true],
		];
	for (const [name, gitVersion, gh, auth, claude] of doctorModes) {
		const directory = join(context.root, `doctor-${name}`);
		mkdirSync(directory);
		const executables: Array<[string, string | null]> = [
			["git", gitVersion ? `echo "git version ${gitVersion}"` : null],
			[
				"gh",
				gh
					? `if [ "$1" = "--version" ]; then exit 0; fi\nexit ${auth ? "0" : "1"}`
					: null,
			],
			["claude", claude ? "exit 0" : null],
		];
		for (const [executable, body] of executables)
			if (body !== null)
				writeFileSync(join(directory, executable), `#!/bin/sh\n${body}\n`, {
					mode: 0o755,
				});
		await take(
			`doctor --check ${name}（依存コマンド疑似応答）`,
			["doctor", "--check"],
			context.root,
			name === "all-ok" || name === "optional-missing" ? 0 : 1,
			{ env: { PATH: directory } },
		);
		if (name === "all-ok")
			await take(
				"doctor 非対応OS（関数へlinux/x64を指定・依存疑似応答）",
				["doctor", "--check"],
				context.root,
				1,
				{
					env: { PATH: directory },
					command: [
						context.bun,
						"--eval",
						`import {checkEnvironment} from ${JSON.stringify(join(dirname(context.cli), "commands/doctor.ts"))}; await checkEnvironment({platform:"linux",arch:"x64"})`,
					],
				},
			);
	}
	return items;
}
