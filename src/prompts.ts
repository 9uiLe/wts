import "./terminal";
import { Writable } from "node:stream";
import { confirm, isCancel, text } from "@clack/prompts";
import { colors } from "./terminal";
import { ui } from "./ui";

export class Cancelled extends Error {}

async function withPromptOutput<T>(
	action: (output: Writable) => Promise<T>,
): Promise<T> {
	if (colors(process.stdout).level > 0) return action(process.stdout);
	// 固定 Bun の styleText は Clack の色を無効化しないため、
	// カーソル制御を残し、装飾の SGR だけを取り除く。
	const sgr = new RegExp(`${String.fromCharCode(27)}\\[[\\d;]*m`, "g");
	const output = new Writable({
		write(chunk, _encoding, callback) {
			process.stdout.write(chunk.toString().replace(sgr, ""), callback);
		},
	});
	Object.defineProperties(output, {
		isTTY: { get: () => process.stdout.isTTY },
		columns: { get: () => process.stdout.columns },
		rows: { get: () => process.stdout.rows },
	});
	const resize = () => output.emit("resize");
	process.stdout.on("resize", resize);
	try {
		return await action(output);
	} finally {
		process.stdout.off("resize", resize);
		output.destroy();
	}
}

export function requireTTY(): void {
	if (!process.stdin.isTTY || !process.stdout.isTTY)
		throw new Error(
			"対話入力には TTY 端末が必要です。オプションで値を指定してください。",
		);
}

export async function askText(
	message: string,
	defaultValue = "",
): Promise<string> {
	requireTTY();
	const answer = await withPromptOutput((output) =>
		text({
			output,
			message,
			placeholder: defaultValue,
			defaultValue,
		}),
	);
	if (isCancel(answer)) {
		ui.cancel();
		throw new Cancelled();
	}
	return answer || defaultValue;
}

export async function confirmAction(
	message: string,
	{ initialValue = false }: { initialValue?: boolean } = {},
): Promise<boolean> {
	requireTTY();
	const answer = await withPromptOutput((output) =>
		confirm({
			output,
			message,
			initialValue,
			active: "はい",
			inactive: "いいえ",
		}),
	);
	if (isCancel(answer) || !answer) {
		ui.cancel();
		return false;
	}
	return true;
}
