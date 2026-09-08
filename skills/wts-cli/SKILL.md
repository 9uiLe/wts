---
name: wts-cli
description: >-
  Use the wts CLI to initialize .wts.json, create Git worktree sessions,
  add stacked branches, restack and push them, or clean up merged branches
  and worktrees. Use when the user mentions wts, wts-cli, or asks to operate
  a project's wts-managed sessions. Orca-managed worktrees use orca-cli.
---

# wts CLI

このファイルはスキルの入口です。操作手順は実際に使用する wts に埋め込まれたガイドを読みます。

ユーザーや実行環境が指定した実行ファイルを使い、指定がなければ PATH 上の `wts` を解決してください。その実行ファイルを、このセッションの後続コマンドでも使い続けます。以下の `wts` は解決した実行ファイルに置き換えてください。

**操作前に必ずガイドを取得し、読んでください。**

```sh
wts skills get wts-cli
```

取得に失敗した場合はエラーを報告し、別の実行ファイルへ自動的に切り替えないでください。`skills` が未知のコマンドである場合は、その実行ファイルの `--help` と `--version` で対応範囲を確認し、ガイドを提供するバージョンへの更新が必要であることを伝えてください。記憶から変更コマンドを推測して実行しないでください。

このスキルの利用は、push・削除・設定変更などに対するユーザーの許可や実行環境の権限を拡張しません。すでに依頼された操作は、その許可の範囲で進めてください。
