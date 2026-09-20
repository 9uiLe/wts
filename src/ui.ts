import { type Block, render, task } from "./hamio";

// hamio API v1 の文字列4096 bytes・表示32 blocksに従う。
function messages(
	text: string,
	level: "info" | "success" | "warning" | "error",
): void {
	const blocks: Block[] = [];
	for (const line of text.split("\n")) {
		let part = "";
		let bytes = 0;
		for (const character of line) {
			const size = Buffer.byteLength(character);
			if (bytes + size > 4096) {
				blocks.push({ kind: "message", level, text: part });
				part = "";
				bytes = 0;
			}
			part += character;
			bytes += size;
		}
		blocks.push({ kind: "message", level, text: part });
	}
	for (let index = 0; index < blocks.length; index += 32)
		render(blocks.slice(index, index + 32));
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
		// hamio API v1 の key-value は1 blockあたり200項目。
		for (let index = 0; index < rows.length; index += 200)
			render([
				{
					kind: "key-value",
					items: rows
						.slice(index, index + 200)
						.map(([label, value]) => ({ label, value })),
				},
			]);
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
