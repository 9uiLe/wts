---
name: wts-cli
description: >-
  Configure, inspect, and operate wts-managed Git worktree sessions and branch
  stacks. Use for wts operations, not merely editing wts source or documentation.
---

# wts CLI

ユーザーや実行環境が指定した実行ファイルを使い、指定がなければ PATH 上の `wts` を解決します。操作に使う実行ファイルのガイドが会話内に未取得なら、その実行ファイルで次を実行します。

```sh
wts skills get wts-cli
```

後続コマンドにも同じ実行ファイルを使います。実行ファイルの切り替え・更新がなければ、取得済みのガイドを再利用します。

ガイドの「実行環境と入力」を読み、「操作の選択」の表から依頼に対応する節へ進みます。設定、命名スクリプト、dry-run の詳細は、その操作で使う場合に読みます。ガイドはバイナリに含まれ、インストール先に別の参照ファイルは不要です。

ガイドを取得できなければ、実際のエラーを報告し、そのガイドに依存する操作を止めます。別バージョンの手順や推測で実行せず、実行ファイルの所在・起動失敗など、操作を伴わない調査は進められます。
