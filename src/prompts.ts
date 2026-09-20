import { form, isInteractive } from "./hamio";
export { isInteractive } from "./hamio";
import { ui } from "./ui";

export class Cancelled extends Error {}

export function requireTTY(): void {
	if (!isInteractive())
		throw new Error(
			"対話入力には stdin と stderr の TTY 端末が必要です。オプションで値を指定してください。",
		);
}

export async function askText(
	message: string,
	defaultValue = "",
): Promise<string> {
	requireTTY();
	const choice = await form({
		kind: "select",
		label: message,
		options: [
			{
				value: "default",
				label: defaultValue ? `既定値を使う: ${defaultValue}` : "スキップ",
			},
			{ value: "input", label: "入力する" },
		],
	});
	if (choice === "default") return defaultValue;
	const value =
		choice === undefined
			? undefined
			: await form({ kind: "text", label: `${message}を入力` });
	if (value === undefined) {
		ui.cancel();
		throw new Cancelled();
	}
	return String(value);
}

export async function confirmAction(message: string): Promise<boolean> {
	requireTTY();
	const answer = await form({ kind: "confirm", label: message });
	if (answer !== true) {
		ui.cancel();
		return false;
	}
	return true;
}
