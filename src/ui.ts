import { colors, terminal } from "./terminal";
import ora from "ora";

function write(stream: NodeJS.WriteStream, message: string): void {
	stream.write(terminal(stream) ? message : Bun.stripANSI(message));
}

function status(
	message: string,
	symbol: string,
	kind: "green" | "cyan" | "yellow" | "red",
	stream: NodeJS.WriteStream,
	prefix = "",
) {
	const chalk = colors(stream);
	write(
		stream,
		`${terminal(stream) ? `  ${chalk[kind](symbol)} ${message.replaceAll("\n", "\n    ")}` : `${prefix}${message}`}\n`,
	);
}

export function stdoutStyling(
	text: string,
	role: "title" | "command" | "option",
): string {
	const chalk = colors(process.stdout);
	if (role === "title") return chalk.bold(text);
	if (role === "command") return chalk.cyan(text);
	return chalk.green(text);
}

export function commandLine(args: readonly string[]): string {
	return args
		.map((arg) =>
			/^[A-Za-z0-9_@%+=:,./-]+$/.test(arg)
				? arg
				: `'${arg.replaceAll("'", "'\\''")}'`,
		)
		.join(" ");
}

export const ui = {
	heading(command: string): void {
		if (!terminal(process.stdout)) return;
		const chalk = colors(process.stdout);
		process.stdout.write(
			`\n  ${chalk.bold.cyan("wts")} ${chalk.bold(command)}\n\n`,
		);
	},
	success(message: string): void {
		status(message, "✓", "green", process.stdout);
	},
	info(message: string): void {
		status(message, "•", "cyan", process.stdout);
	},
	warn(message: string): void {
		status(message, "!", "yellow", process.stderr, "警告: ");
	},
	error(message: string): void {
		status(message, "✗", "red", process.stderr, "エラー: ");
	},
	detail(label: string, value: string): void {
		const chalk = colors(process.stdout);
		write(
			process.stdout,
			`${terminal(process.stdout) ? "    " : ""}${chalk.dim(label)}  ${value}\n`,
		);
	},
	details(rows: readonly (readonly [string, string])[]): void {
		const width = Math.max(0, ...rows.map(([label]) => Bun.stringWidth(label)));
		for (const [label, value] of rows) {
			ui.detail(
				terminal(process.stdout)
					? label + " ".repeat(width - Bun.stringWidth(label))
					: label,
				value,
			);
		}
	},
	plan(message: string): void {
		status(message, "→", "cyan", process.stdout);
	},
	cancel(): void {
		status("キャンセルしました。", "−", "yellow", process.stdout);
	},
	line(message: string): void {
		const indent = terminal(process.stdout) ? "  " : "";
		write(
			process.stdout,
			`${message
				.split("\n")
				.map((line) => `${indent}${line}`)
				.join("\n")}\n`,
		);
	},
	check(ok: boolean, message: string): void {
		const chalk = colors(process.stdout);
		ui.line(`${ok ? chalk.green("OK") : chalk.red("NG")}: ${message}`);
	},
	async task<T>(message: string, action: () => Promise<T>): Promise<T> {
		if (!terminal(process.stderr)) return action();
		const spinner = ora({
			text: message,
			stream: process.stderr,
			color: colors(process.stderr).level > 0 ? "cyan" : false,
			discardStdin: false,
			hideCursor: true,
			indent: 2,
		}).start();
		try {
			return await action();
		} finally {
			spinner.stop();
		}
	},
};
