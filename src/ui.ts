import { type Block, render, task } from "./hamio";
import { detailBlocks, messageBlocks, renderRequests } from "./display";

function messages(
	text: string,
	level: "info" | "success" | "warning" | "error",
): void {
	for (const request of renderRequests(messageBlocks(text, level)))
		render(request);
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
		messages(`wts ${command}`, "info");
	},
	success(message: string): void {
		messages(message, "success");
	},
	info(message: string): void {
		messages(message, "info");
	},
	warn(message: string): void {
		messages(message, "warning");
	},
	error(message: string): void {
		messages(message, "error");
	},
	detail(label: string, value: string): void {
		ui.details([[label, value]]);
	},
	details(rows: readonly (readonly [string, string])[]): void {
		for (const request of renderRequests(detailBlocks(rows))) render(request);
	},
	plan(message: string): void {
		messages(message, "info");
	},
	cancel(): void {
		messages("キャンセルしました。", "info");
	},
	line(message: string): void {
		messages(message, "info");
	},
	result(data: Extract<Block, { kind: "result" }>["data"]): void {
		render([{ kind: "result", success: true, data }]);
	},
	check(ok: boolean, message: string): void {
		messages(`${ok ? "OK" : "NG"}: ${message}`, ok ? "success" : "error");
	},
	task,
};
