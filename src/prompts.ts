import { cancel, confirm, isCancel, text } from "@clack/prompts";

export class Cancelled extends Error {}

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
	const answer = await text({
		message,
		placeholder: defaultValue,
		defaultValue,
	});
	if (isCancel(answer)) {
		cancel("キャンセルしました。");
		throw new Cancelled();
	}
	return answer || defaultValue;
}

export async function confirmAction(message: string): Promise<boolean> {
	requireTTY();
	const answer = await confirm({ message, initialValue: false });
	if (isCancel(answer) || !answer) {
		cancel("キャンセルしました。");
		return false;
	}
	return true;
}
