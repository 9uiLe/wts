import { randomUUID } from "node:crypto";
import type { LoadedConfig } from "./config";
import type { Git } from "./git";
import { ui } from "./ui";

export type NamingContext = {
	kind: "branch" | "worktree";
	task: string;
	date: string;
	uuid: string;
	defaultName: string;
	branch?: string;
	rootBranch?: string;
	prNumber?: string;
};

export function defaultNaming(): {
	date: string;
	uuid: string;
	defaultName: string;
} {
	const parts = new Intl.DateTimeFormat("en-GB", {
		timeZone: "Asia/Tokyo",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(new Date());
	const value = (type: string) =>
		parts.find((part) => part.type === type)?.value;
	const date = `${value("year")}${value("month")}${value("day")}`;
	const uuid = randomUUID();
	return { date, uuid, defaultName: `${date}-${uuid}` };
}

export async function generateName(
	config: LoadedConfig,
	context: NamingContext,
): Promise<string> {
	const rule = config.config.naming?.[context.kind];
	if (!rule) return context.defaultName;
	let child: Bun.Subprocess<Buffer, "pipe", "pipe">;
	try {
		child = Bun.spawn([rule.script], {
			cwd: config.directory,
			stdin: Buffer.from(
				JSON.stringify({
					...context,
					prompt: rule.prompt ?? "",
				}),
			),
			stdout: "pipe",
			stderr: "pipe",
		});
	} catch {
		throw new Error(`${context.kind} 命名スクリプトを実行できませんでした`);
	}
	const [exitCode, stdout] = await ui.task(
		context.kind === "branch"
			? "ブランチ名を生成しています"
			: "Worktree 名を生成しています",
		() =>
			Promise.all([
				child.exited,
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
			]),
	);
	if (exitCode !== 0 || child.signalCode) {
		throw new Error(`${context.kind} 命名スクリプトが失敗しました`);
	}
	const name = stdout.replace(/\r?\n$/, "");
	if (!name.trim() || /[\r\n\0]/.test(name)) {
		throw new Error(
			`${context.kind} 命名スクリプトは名前を 1 行で出力してください`,
		);
	}
	return name;
}

export function validateBranchName(git: Git, branch: string): void {
	if (
		branch.startsWith("-") ||
		branch.startsWith("@{") ||
		/[\0\r\n]/.test(branch) ||
		git.tryRun(["check-ref-format", "--branch", branch]).code !== 0
	) {
		throw new Error(`不正なブランチ名: ${branch}`);
	}
	if (
		git.tryRun(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])
			.code === 0
	) {
		throw new Error(`ブランチ ${branch} は既に存在します`);
	}
}

export function validateWorktreeName(name: string): void {
	if (
		!name.trim() ||
		name === "." ||
		name === ".." ||
		name.toLowerCase() === ".git" ||
		/[/\\\0\r\n]/.test(name)
	) {
		throw new Error(`不正な worktree 名: ${name}`);
	}
}
