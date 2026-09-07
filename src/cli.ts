#!/usr/bin/env bun
import { confirm, intro, isCancel, outro, cancel } from "@clack/prompts";
import { Command } from "commander";
import { version } from "../package.json";

const program = new Command()
  .name("wts")
  .description("Git Worktree Session")
  .version(version);

async function doctor({ interactive }: { interactive?: boolean }): Promise<void> {
  if (!interactive) {
    console.log(`wts ${version}\nplatform=${process.platform}\narch=${process.arch}`);
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

program.command("doctor")
  .description("CLI の起動環境を確認します")
  .option("--interactive", "対話 UI の動作を確認します")
  .action(doctor);

await program.parseAsync();
