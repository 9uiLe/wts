#!/usr/bin/env bun
import { confirm, intro, isCancel, outro, cancel } from "@clack/prompts";
import { Command, Option } from "commander";
import { version } from "./version";
import { startStackBranch, startWorktreeSession } from "./start";
import { cleanupSessionBranches } from "./cleanup";
import { restack } from "./restack";
import { Cancelled, repository, repositoryLocation } from "./session";
import { checkEnvironment } from "./doctor";
import { initializeConfig, loadConfigFile } from "./config";
import { resolve } from "node:path";

const program = new Command()
	.name("wts")
	.description("Git Worktree Session")
	.version(version);

async function doctor({
	interactive,
	check,
}: {
	interactive?: boolean;
	check?: boolean;
}): Promise<void> {
	if (check) {
		await checkEnvironment();
		return;
	}
	if (!interactive) {
		console.log(
			`wts ${version}\nplatform=${process.platform}\narch=${process.arch}`,
		);
		return;
	}

	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		program.error("対話モードは TTY 端末で実行してください。");
	}

	intro("wts doctor");
	const proceed = await confirm({ message: "起動環境を表示しますか？" });
	if (isCancel(proceed) || !proceed) {
		cancel("キャンセルしました。");
		return;
	}

	outro(`${process.platform} / ${process.arch}`);
}

program
	.command("doctor")
	.description("CLI の起動環境を確認します")
	.addOption(
		new Option("--interactive", "対話 UI の動作を確認します").conflicts(
			"check",
		),
	)
	.addOption(
		new Option(
			"--check",
			"対応環境・依存コマンド・GitHub 認証を検査します",
		).conflicts("interactive"),
	)
	.action(doctor);

program
	.command("init")
	.description("プロジェクトの .wts.json を生成します")
	.action(() => {
		const { root, main } = repositoryLocation();
		console.log(`設定を生成しました: ${initializeConfig(root, main)}`);
	});

program
	.command("config")
	.description("プロジェクト設定を確認します")
	.command("check [file]")
	.description("設定の項目・値・パスを検査します（スクリプトは実行しません）")
	.action(async (file?: string) => {
		const loaded = file
			? loadConfigFile(resolve(file))
			: (await repository()).config;
		console.log(`設定 OK: ${loaded.path}\nWorktrees  ${loaded.worktreesBase}`);
	});

function dryRun(command: Command): Command {
	return command.addOption(
		new Option("--dry-run", "変更せず実行予定を表示します").default(
			process.env.DRY_RUN === "1",
		),
	);
}

dryRun(
	program
		.command("start")
		.description("作業セッションの worktree を作成します"),
)
	.option(
		"--task <text>",
		"命名スクリプトへ渡す作業内容（既定の命名は日付＋UUID）",
	)
	.addOption(
		new Option(
			"--base-branch <branch>",
			"ベースブランチ（既定: origin/main）",
		).env("BASE_BRANCH"),
	)
	.addOption(
		new Option("--copy-from <directory>", "管理外ファイルのコピー元").env(
			"COPY_FROM",
		),
	)
	.action(startWorktreeSession);

dryRun(
	program
		.command("stack")
		.description("現在の worktree に次のスタックブランチを作成します"),
)
	.option(
		"--task <text>",
		"命名スクリプトへ渡す作業内容（既定の命名は日付＋UUID）",
	)
	.addOption(
		new Option("--pr-number <number>", "スタック内の番号（2 以上）").env(
			"PR_NUMBER",
		),
	)
	.action(startStackBranch);

dryRun(
	program
		.command("cleanup")
		.description("マージ済みのローカルブランチと worktree を整理します"),
)
	.option("--yes", "表示した削除対象の確認を省略します")
	.action(cleanupSessionBranches);

dryRun(
	program
		.command("restack")
		.description("線形スタックを rebase し lease 付きで一括 push します"),
)
	.addOption(
		new Option(
			"--base-branch <branch>",
			"ベースブランチ（既定: origin/main）",
		).env("BASE_BRANCH"),
	)
	.addOption(
		new Option(
			"--push-only",
			"保存した lease を使い push だけ行います",
		).default(process.env.PUSH_ONLY === "1"),
	)
	.addOption(
		new Option("--push", "push の確認を省略します").default(
			process.env.PUSH === "1",
		),
	)
	.action(restack);

try {
	await program.parseAsync();
} catch (error) {
	if (!(error instanceof Cancelled))
		program.error(error instanceof Error ? error.message : String(error));
}
