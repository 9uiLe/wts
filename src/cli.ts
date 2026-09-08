#!/usr/bin/env bun
import "./terminal";
import { Command, Option } from "commander";
import { cleanupSessionBranches } from "./commands/cleanup";
import { checkConfig } from "./commands/config";
import { doctor } from "./commands/doctor";
import { init } from "./commands/init";
import { restack } from "./commands/restack";
import { startStackBranch } from "./commands/stack";
import { startWorktreeSession } from "./commands/start";
import { Cancelled } from "./prompts";
import { stdoutStyling, ui } from "./ui";
import { version } from "./version";

const program = new Command()
	.name("wts")
	.description("Git Worktree Session")
	.configureHelp({
		styleTitle: (text) => stdoutStyling(text, "title"),
		styleCommandText: (text) => stdoutStyling(text, "command"),
		styleOptionText: (text) => stdoutStyling(text, "option"),
	})
	.configureOutput({
		outputError: (message) =>
			ui.error(message.replace(/^error: /, "").trimEnd()),
	})
	.version(version);

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
	.action(init);

program
	.command("config")
	.description("プロジェクト設定を確認します")
	.command("check [file]")
	.description("設定の項目・値・パスを検査します（スクリプトは実行しません）")
	.action(checkConfig);

function dryRun(command: Command): Command {
	return command.addOption(
		new Option("--dry-run", "変更せず実行予定を表示します").default(
			process.env.DRY_RUN === "1",
		),
	);
}

function baseBranchOption(): Option {
	return new Option(
		"--base-branch <branch>",
		"ベースブランチ（省略時は設定の origin/<baseBranch>、未設定なら対話）",
	).env("BASE_BRANCH");
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
	.addOption(baseBranchOption())
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
	.addOption(baseBranchOption())
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
