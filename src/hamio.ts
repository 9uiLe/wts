import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	command,
	commandAsync,
	type CommandResult,
	streamCommand,
} from "./process";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Block =
	| {
			kind: "message";
			level: "info" | "success" | "warning" | "error";
			text: string;
	  }
	| { kind: "key-value"; items: { label: string; value: string }[] }
	| { kind: "result"; success: boolean; data: Json };
export type Field =
	| { kind: "text" | "confirm"; label: string }
	| {
			kind: "select";
			label: string;
			options: { value: string; label: string }[];
	  };

export class HamioError extends Error {}

let executable: string | undefined;
let outputFormat: () => "human" | "json" | undefined = () => undefined;

export function configureHamio(format: typeof outputFormat): void {
	outputFormat = format;
}

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function launch<T>(action: () => T): T {
	try {
		return action();
	} catch {
		throw new HamioError(
			"hamio を起動できませんでした。実行ファイルと権限を確認してください。",
		);
	}
}

export function isInteractive(): boolean {
	return Boolean(
		outputFormat() !== "json" &&
			process.stdin.isTTY &&
			process.stderr.isTTY &&
			process.env.TERM !== "dumb" &&
			!process.env.CI,
	);
}

export function ensureHamio(): string {
	if (executable) return executable;
	const path = Bun.which("hamio");
	if (!path)
		throw new HamioError(
			"hamio v0.1.0 が見つかりません。導入して PATH に追加してください。",
		);
	const result = launch(() => command(path, ["capabilities"], process.cwd()));
	let capabilities: unknown;
	try {
		capabilities = JSON.parse(result.out);
	} catch {
		throw new HamioError("hamio の機能情報を読み取れませんでした。");
	}
	if (
		result.code !== 0 ||
		!record(capabilities) ||
		capabilities.apiVersion !== 1 ||
		capabilities.version !== "0.1.0"
	)
		throw new HamioError("hamio v0.1.0 / API v1 が必要です。");
	executable = path;
	return path;
}

function appearance(): string[] {
	const format = outputFormat();
	return format ? ["--format", format] : [];
}

function response(result: CommandResult): Record<string, unknown> {
	let value: unknown;
	try {
		value = JSON.parse(result.out);
	} catch {
		throw new HamioError(
			`hamio の応答が JSON ではありません（終了コード ${result.code}）。`,
		);
	}
	if (!record(value) || value.apiVersion !== 1)
		throw new HamioError("hamio の応答が API v1 に一致しません。");
	if (result.code === 130 && value.status === "cancelled") return value;
	if (result.code !== 0 || value.status !== "ok") {
		const detail =
			record(value.error) && typeof value.error.code === "string"
				? value.error.code
				: value.status;
		throw new HamioError(
			`hamio の処理に失敗しました（${String(detail)}、終了コード ${result.code}）。`,
		);
	}
	return value;
}

export function render(blocks: Block[]): void {
	const path = ensureHamio();
	const result = launch(() =>
		command(
			path,
			["render", ...appearance()],
			process.cwd(),
			JSON.stringify({ apiVersion: 1, blocks }),
			{ inheritStderr: true },
		),
	);
	response(result);
	process.stdout.write(result.out);
}

export async function form(
	field: Field,
): Promise<string | boolean | undefined> {
	const path = ensureHamio();
	const directory = mkdtempSync(join(tmpdir(), "wts-form-"));
	try {
		const definition = join(directory, "form.json");
		writeFileSync(
			definition,
			JSON.stringify({
				apiVersion: 1,
				id: "wts",
				fields: [{ id: "value", ...field }],
			}),
			{ mode: 0o600 },
		);
		const result = await commandAsync(
			path,
			[
				"form",
				"--definition",
				definition,
				"--interactive",
				outputFormat() === "json" ? "never" : "auto",
			],
			process.cwd(),
			undefined,
			{ inheritStdin: true, inheritStderr: true },
		).catch(() => {
			throw new HamioError("hamio の対話プロセスを実行できませんでした。");
		});
		const answer = response(result);
		if (answer.status === "cancelled") return undefined;
		const value = record(answer.values) ? answer.values.value : undefined;
		if (answer.id !== "wts")
			throw new HamioError("hamio の回答 ID が質問に一致しません。");
		if (field.kind === "confirm" && typeof value === "boolean") return value;
		if (
			field.kind !== "confirm" &&
			typeof value === "string" &&
			(field.kind !== "select" ||
				field.options.some((option) => option.value === value))
		)
			return value;
		throw new HamioError("hamio の回答が質問の形式に一致しません。");
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

export async function task<T>(
	label: string,
	action: () => Promise<T>,
): Promise<T> {
	const path = ensureHamio();
	const child = launch(() => streamCommand(path, ["stream", ...appearance()]));
	const output = new Response(child.stdout).text();
	let seq = 0;
	async function event(
		type: string,
		data: Record<string, Json>,
	): Promise<void> {
		child.stdin.write(
			`${JSON.stringify({ apiVersion: 1, runId: "wts", seq: seq++, type, ...data })}\n`,
		);
		await child.stdin.flush();
	}
	async function finish(success: boolean): Promise<void> {
		await event("task.finish", {
			taskId: "operation",
			status: success ? "succeeded" : "failed",
		});
		await event("run.finish", { result: { success } });
		await child.stdin.end();
		const result = { code: await child.exited, out: await output, err: "" };
		response(result);
		process.stdout.write(result.out);
	}
	try {
		await event("run.start", { title: label });
		await event("task.start", { taskId: "operation", label });
		let value: T;
		try {
			value = await action();
		} catch (error) {
			try {
				await finish(false);
			} catch {
				// 業務の失敗を表示障害で置き換えない。
			}
			throw error;
		}
		await finish(true);
		return value;
	} finally {
		if (child.exitCode === null) child.kill();
		await child.exited;
		await output;
	}
}

// hamio 自体が起動・表示できない場合にも、機械利用側へ失敗を通知する。
export function reportHamioFailure(error: HamioError): void {
	process.stdout.write(
		`${JSON.stringify({ apiVersion: 1, status: "error", error: { code: "HAMIO_UNAVAILABLE", message: error.message } })}\n`,
	);
}
