# wts

Git Worktree Session。Apple Silicon macOS 向けの TypeScript CLI です。現在は開発環境と CLI の基本動作を用意した初期段階で、worktree 操作は未実装です。

## 開発環境

Apple Silicon Mac と、`nix-command`・`flakes` を有効にした Nix が必要です。Nix の devShell が Bun、Git、依存監査などの開発ツールを提供し、npm 依存は Bun が管理します。

リポジトリを取得し、ルートで実行してください。

```bash
nix develop
nix flake metadata
nix flake check
bun install --frozen-lockfile --ignore-scripts
bun run verify:deps
bun run check
```

`flake.lock` と `bun.lock` を Git 管理しています。通常の開発・CI では固定された依存を使用し、依存の追加・更新時だけロックファイルを変更してレビューします。

## コマンド

```bash
bun run dev --help
bun run dev --version
bun run dev doctor
bun run dev doctor --interactive
```

Commander が引数・ヘルプを処理し、Clack が対話 UI を提供します。対話モードのキャンセルは正常終了として扱います。現在の CLI は外部コマンド、設定ファイル、追加の環境変数、ネットワーク接続を実行時に要求しません。対話モードには端末が必要です。

| コマンド | 内容 |
| --- | --- |
| `bun run dev` | ソースから CLI を起動 |
| `bun run typecheck` | TypeScript の型チェック |
| `bun run test` | CLI の振る舞いを検証 |
| `bun run verify:deps` | 固定依存のインストールと依存監査 |
| `bun run build` | Apple Silicon 向け検証用バイナリを生成 |
| `bun run check` | 型チェック・テスト・ビルドを順に実行 |

依存監査には `bun audit` と `osv-scanner` を併用します。監査にはネットワーク接続が必要です。実行結果と監査情報は `release/` に記録します。依存を更新する際は、公開元、ライセンス、既知の脆弱性、インストールスクリプト、推移的依存の差分も確認してください。

## ビルドと CI

devShell 内の Apple Silicon macOS 上で実行します。

```bash
bun run verify:deps
bun run typecheck
bun run test
bun run build
./dist/wts-macos-arm64 --help
./dist/wts-macos-arm64 --version
cd release
shasum -a 256 -c wts-macos-arm64.sha256
```

`scripts/build.ts` が `bun-darwin-arm64` 向けに Bun ランタイムを同梱した実行ファイルを生成します。

```text
dist/wts-macos-arm64
release/wts-macos-arm64
release/wts-macos-arm64.sha256
release/BUILD_INFO
```

`BUILD_INFO` にビルド環境、Git コミット、ターゲット、最低対応 macOS、署名・公証、外部要件の状態を記録します。`dist/` と `release/` は生成物であり、Git 管理しません。

GitHub Actions は [公式仕様の `macos-15` ARM64 ランナー](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)で Nix 環境を使用して検証します。アクション参照はコミット SHA に固定し、通常の検証ジョブに公開権限を付与しません。リリース公開は自動化していません。ワークフローのリモート実行は、push 後に確認してください。

## 手動インストール・更新

正式リリースの配布先は GitHub Releases です。現在生成する成果物は検証用であり、正式リリースではありません。非公開リポジトリのリリース取得には閲覧権限が必要です。

リリース公開後は、同じリリースの `wts-macos-arm64`、`wts-macos-arm64.sha256`、`BUILD_INFO` を同じディレクトリへ取得し、そのディレクトリで実行します。利用者側に Nix、Bun、Node.js は不要です。

```bash
shasum -a 256 -c ./wts-macos-arm64.sha256
```

照合に成功した場合だけ配置してください。

```bash
mkdir -p "$HOME/.local/bin"
install -m 755 ./wts-macos-arm64 "$HOME/.local/bin/wts"
"$HOME/.local/bin/wts" --version
"$HOME/.local/bin/wts" --help
```

`~/.local/bin` が PATH にない場合は `~/.zshrc` に次を追加してシェルを再起動してください。

```bash
export PATH="$HOME/.local/bin:$PATH"
```

更新時は実行中の wts を終了し、新しいリリースのファイルを取得して、同じ照合・配置手順を繰り返します。署名・公証が提供されるリリースでは、その検証手順にも従ってください。チェックサムや署名の検証に失敗した場合はインストール・更新を中止します。

## 正式リリース前の確認事項

- 最低対応 macOS バージョンを決定し、対象環境で起動、対話、キャンセル、終了を検証する。
- Nix 環境外で実行し、GitHub Releases から取得したファイルのインストールと更新を検証する。
- Apple Developer ID 署名・公証の採否を決定する。現在は未実施のため、Gatekeeper が警告・ブロックする可能性がある。未実施で配布する場合は、対象 macOS で挙動と許可手順を検証してリリース本文に記載する。チェックサム照合では Gatekeeper の制約は解消されない。
- レビュー済みコミットとクリーンな作業ツリーからビルドし、監査結果、CI の ARM64 実行結果、`BUILD_INFO`、最終バイナリのチェックサムを確認する。
- 公開先の権限とリリース承認を確認する。署名・公証を採用する場合は最終バイナリへ適用・検証してからチェックサムを生成する。

最低対応 macOS などの未確定事項を残したまま正式公開しません。Intel Mac、Linux、Windows、自動更新、`nix build` による配布物生成は初期対象外です。
