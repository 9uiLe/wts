# wts の開発とリリース

wts（Git Worktree Session）は Apple Silicon macOS 向けの TypeScript CLI です。この文書は開発環境、ソースからの実行、検証、ビルド、CI、正式リリースの条件を定義します。利用者向けのコマンドと導入手順は [README](../README.md)、責務と設計方針は [設計書](design.md)、変更時の規約は [AGENTS.md](../AGENTS.md) を参照してください。

開発ツールは Nix Flakes、パッケージの依存管理・実行・テスト・単体実行ファイルの生成は Bun が担当します。コマンド定義には Commander、対話 UI には `@clack/prompts` を使用します。

## 開発を始める

Apple Silicon Mac、Xcode Command Line Tools、`nix-command` と `flakes` を有効にした Nix が必要です。依存の取得と監査にはネットワーク接続を使用します。

リポジトリのルートで実行してください。

```bash
nix develop --no-update-lock-file
nix flake check --no-update-lock-file
bun install --frozen-lockfile --ignore-scripts
bun run verify:deps
bun run check
```

devShell は Bun、Git、OSV-Scanner、Coreutils を提供します。開発ツールの解決結果は `flake.lock`、npm パッケージの解決結果は `bun.lock` で固定します。通常の開発と CI ではロックファイルを更新せず、devShell の Bun を使用してください。

## ソースから実行する

リポジトリのルートにある devShell 内で、`bun run dev` に CLI の引数を渡します。

```bash
bun run dev --help
bun run dev --version
bun run dev doctor
bun run dev doctor --interactive
```

対話モードでは標準入力と標準出力の両方に TTY が必要です。対話を変更した場合は、肯定入力、否定入力、Ctrl-C によるキャンセルを確認してください。各コマンドの出力と終了コードの契約は [README](../README.md) に記載しています。

## 開発コマンド

以下はリポジトリのルートにある devShell 内で実行します。

| コマンド | 処理 |
| --- | --- |
| `bun run dev` | ソースから CLI を起動する |
| `bun run format` | Biome で整形し、ファイルを更新する |
| `bun run format:check` | Biome の整形規則に一致するか検査する |
| `bun run lint` | Biome の recommended ルールで静的検査する |
| `bun run typecheck` | `tsc --noEmit` で型を検査する |
| `bun run test` | CLI の振る舞いをテストする |
| `bun run verify:deps` | 固定依存をインストールし、依存一覧と監査結果を生成する |
| `bun run build` | Apple Silicon 向け検証用バイナリを生成し、起動を検証する |
| `bun run check` | 整形検査、lint、型チェック、テスト、ビルドを順に実行する |

整形と lint は `biome.json` に定義し、`src/`、`scripts/`、`tests/` 内の TypeScript・JSON ファイルとルートの JSON ファイルを対象にします。整形は Biome の既定設定、lint は recommended ルールを使用します。型検査は TypeScript が担当します。

`verify:deps` は `bun audit` と `osv-scanner` を実行し、両方の成功を要求します。パッケージのメタデータは `release/DEPENDENCIES.json`、監査結果は `release/bun-audit.json`・`release/osv-audit.json` とそれぞれの `.stderr`、問い合わせ日時・ツール・終了コードは `release/AUDIT_INFO` に記録します。監査 API が公開しないデータベースのスナップショット日時は記録できません。

## ビルド成果物

`bun run build` は Apple Silicon macOS 上で `bun-darwin-arm64` を指定してコンパイルし、生成バイナリの `--help`、`--version`、`doctor` を実行してから以下の成果物を作成します。

```text
dist/wts-macos-arm64
release/wts-macos-arm64
release/wts-macos-arm64.sha256
release/BUILD_INFO
```

`BUILD_INFO` にはバージョン、Git コミットと作業ツリーの状態、ビルド日時、Bun・Nix・OS、ターゲット、ロックファイルの SHA-256、最低対応 macOS、署名・公証、外部要件を記録します。`dist/` と `release/` は Git 管理対象外です。

チェックサムを照合するには `release/` で実行してください。

```bash
shasum -a 256 -c wts-macos-arm64.sha256
```

ビルドスクリプトが生成する成果物は `build_kind=verification_only` の検証用です。最低対応 macOS は未確定で、Developer ID 署名と公証は行いません。ビルドの成功だけでは正式リリースの条件を満たしません。

## CI

[GitHub Actions](../.github/workflows/ci.yml) は push、pull request、手動実行で検証します。`macos-15` ランナー上で ARM64 とクリーンな作業ツリーを確認し、固定した Nix 環境で依存監査、整形検査、lint、型チェック、テスト、ビルド、チェックサム照合、追跡ファイルに差分がないことを検証します。整形検査からビルドまでは `bun run check` で実行します。

アクションはコミット SHA に固定し、権限は `contents: read` とします。CI はリリース公開を行いません。

## 正式リリースの条件

正式公開には以下を満たす必要があります。

- 最低対応 macOS を決定し、対象環境で起動、コマンド、対話入力、キャンセル、終了を検証する。
- Nix 環境外で実行し、GitHub Releases から取得したファイルのインストールと更新を検証する。
- Developer ID 署名・公証の採否を決定する。採用する場合は最終バイナリへ適用・検証してからチェックサムを生成する。採用しない場合は対象 macOS の Gatekeeper の挙動と許可手順を検証し、制約と手順をリリース本文へ記載する。チェックサム照合は Gatekeeper の制約を解消しない。
- レビュー済みコミットとクリーンな作業ツリーから生成し、依存監査、CI の ARM64 実行結果、成果物と `BUILD_INFO` の整合、最終バイナリのチェックサムを確認する。
- 公開先の権限とリリース承認を確認し、バイナリ、チェックサム、ビルド情報を一組で公開する。

Intel Mac、Linux、Windows、自動更新、インストーラー、署名・公証の自動化、`nix build` による配布物生成は対象外です。
