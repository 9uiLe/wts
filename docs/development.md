# wts の開発とリリース

開発者向けに、環境構築、検証、成果物の生成、GitHub Actions からの Pre-release 公開を説明します。利用方法と配布状態は [README](../README.md)、実装の責務と公開判定は [設計書](design.md)、変更時の規約は [AGENTS.md](../AGENTS.md) を参照してください。

## 開発環境

Apple Silicon Mac、Xcode Command Line Tools、`nix-command` と `flakes` を有効にした Nix が必要です。依存の取得と監査にはネットワーク接続を使用します。

[リポジトリを取得](../README.md#リポジトリの取得)し、ルートディレクトリでセットアップと検証を実行します。

```bash
./scripts/setup.sh
nix develop --no-update-lock-file --command bun run verify:deps
./scripts/check.sh
```

Nix Flakes は Bun、Git、OSV-Scanner、Coreutils を提供し、Bun は JavaScript / TypeScript の依存を管理します。ツールは `flake.lock`、パッケージは `bun.lock` で固定します。通常の開発と CI ではロックファイルを更新せず、devShell の Bun を使用してください。インストール時のスクリプトは実行しません。

`setup.sh` は Apple Silicon macOS、Nix、Xcode Command Line Tools の存在を確認し、Flake を検査してから `install-deps.sh` で依存を取得します。Nix や Xcode Command Line Tools 自体のインストールは行いません。依存取得だけを再実行する場合は `./scripts/install-deps.sh` を使用します。

## 開発コマンド

日常操作には [README の独立スクリプト](../README.md#よく使うスクリプト)を使用します。各スクリプトは自身の位置からリポジトリを特定するため、実行時のディレクトリに依存しません。`setup.sh`、`install-deps.sh`、`build.sh`、`check.sh` は引数を取らず、`dev.sh` は CLI 引数をそのまま渡します。`install.sh` の引数は [ビルド成果物](#ビルド成果物)に記載しています。

スクリプトから呼び出す処理と個別の検査は `package.json` に定義しています。個別に実行する場合は `nix develop --no-update-lock-file` で devShell を開き、以下のコマンドを使用します。

| コマンド | 処理 |
| --- | --- |
| `bun run dev` | ソースから CLI を起動する。後ろに `--help`、`--version`、`doctor` などの引数を渡す |
| `bun run format` | Biome で整形し、ファイルを更新する |
| `bun run format:check` | ファイルを変更せずに整形規則を検査する |
| `bun run lint` | Biome の recommended ルールで静的検査する |
| `bun run typecheck` | `tsc --noEmit` で型を検査する |
| `bun run test` | CLI、バージョン、公開判定、インストールの振る舞いをテストする |
| `bun run verify:deps` | 固定依存をインストールし、依存一覧と監査結果を生成する |
| `bun run build` | Apple Silicon 向けバイナリを生成し、起動を検証する |
| `bun run check` | 整形検査、lint、型チェック、テスト、ビルドを順に実行する |

整形と lint の対象・規則は `biome.json`、型検査の設定は `tsconfig.json` で定義します。対話を変更した場合は TTY 上で `bun run dev doctor --interactive` を実行し、肯定入力、否定入力、Ctrl-C によるキャンセルを確認してください。出力と終了コードは [README](../README.md#使い方) に記載しています。

`verify:deps` は `bun audit` と `osv-scanner` の両方の成功を要求します。生成する監査資料は次のとおりです。

| ファイル | 内容 |
| --- | --- |
| `release/DEPENDENCIES.json` | パッケージのメタデータとインストール状態 |
| `release/bun-audit.json`、`release/osv-audit.json` | 脆弱性監査結果 |
| `release/bun-audit.stderr`、`release/osv-audit.stderr` | 監査コマンドの標準エラー |
| `release/AUDIT_INFO` | 問い合わせ日時、ツール、データベース取得先、終了コード、例外の有無 |

## ビルド成果物

`./scripts/build.sh` は固定 Nix 環境で `bun run build` を実行し、バイナリ・SHA-256・`BUILD_INFO` の存在とバイナリのチェックサムを確認します。`./scripts/check.sh` も全検査とビルドの後に同じ成果物検証を行います。ビルドは Apple Silicon macOS 上で `bun-darwin-arm64` 向けにコンパイルし、生成バイナリの `--help`、`--version`、`doctor` を実行します。生成と起動検証を同じ処理で行うため、macOS ARM64 の実行環境が必要です。

通常は `package.json` のバージョンを使用します。配布バージョンを指定する場合は、先頭 `v` なしの SemVer をビルド時に渡します。

```bash
WTS_RELEASE_VERSION=0.2.0-rc.1 ./scripts/build.sh
```

成果物は次の構成です。`dist/` と `release/` は Git 管理対象外です。

```text
dist/wts-macos-arm64
release/wts-macos-arm64
release/wts-macos-arm64.sha256
release/BUILD_INFO
```

`BUILD_INFO` は生成元コミット、作業ツリーの状態、バージョン、ツール・OS、ロックファイルのハッシュ、対応環境と署名・公証の状態を記録します。手動でチェックサムを照合する場合は、`release/` 内で次を実行します。

```bash
shasum -a 256 -c wts-macos-arm64.sha256
```

成果物の種別は `build_kind=verification_only` です。Pre-release として公開する場合も同じ種別を使用します。

ローカル配置には `./scripts/install.sh [成果物ディレクトリ] [配置先ディレクトリ]` を使用します。既定の成果物はリポジトリの `release/`、配置先は `~/.local/bin` です。指定した相対パスは呼び出し時のディレクトリを基準に解釈します。バイナリ・チェックサム・`BUILD_INFO` の存在とチェックサムを確認してから配置します。署名・公証や Gatekeeper 許可は行いません。

## GitHub Actions

両ワークフローは `macos-15` ランナーでクリーンなチェックアウトを確認し、`setup.sh`、依存監査、`check.sh` を実行します。ローカルと同じ入口で ARM64、Flake、依存、整形・lint・型・テスト・ビルド、チェックサムを検証します。使用するアクションはコミット SHA に固定します。

| ワークフロー | 起動 | 権限と成果 |
| --- | --- | --- |
| [CI](../.github/workflows/ci.yml) | push、pull request、手動 | `contents: read` で検証し、追跡ファイルの差分がないことを確認する |
| [Release](../.github/workflows/release.yml) | `master` を選択した手動実行 | 公開ジョブに `contents: write` を付与し、検証済み成果物を Pre-release として公開する |

Release はさらに、Nix 環境外でのバージョン一致・起動と、作業ツリーに変更がないことを確認します。Release ワークフローの同時実行は直列化し、進行中の実行を自動キャンセルしません。

## Pre-release の公開手順

リポジトリの Actions 設定とタグルールで、自動発行される `GITHUB_TOKEN` による Release・タグ作成が許可されている必要があります。

1. GitHub の **Actions → Release → Run workflow** を開きます。
2. ブランチに `master`、`version` に先頭 `v` なしの SemVer（例: `0.2.0`、`0.2.0-rc.1`）を入力して実行します。`master` 以外では公開ジョブがスキップされます。
3. ジョブの成功後、GitHub Releases で `v<version>` の Pre-release と、`wts-macos-arm64`、`wts-macos-arm64.sha256`、`BUILD_INFO` の添付を確認します。

チェックアウト時点の最新 `master` を公開対象とし、ビルド前後に [公開判定](design.md#公開判定) を実行します。最新公開 Release と同じコミット、使用済みバージョン、処理中の `master` 更新、API エラーは公開を止めます。入力バージョンにプレリリース識別子がなくても、公開状態は必ず Pre-release です。

全ファイルのアップロード完了後に下書きを公開します。途中で失敗した場合は GitHub Releases とタグの状態を確認してください。既存の下書きやタグは再実行で上書き・削除されず、使用済みバージョンとして拒否されます。`master` 更新で停止した場合は、最新 `master` を対象に再実行してください。

Release 本文には、検証環境、最低対応 macOS の未確定、Developer ID 署名・公証の未実施、Gatekeeper 許可手順の未検証、チェックサム照合手順を記載します。

## 正式リリースの条件

このワークフローが公開するのは検証用 Pre-release です。正式公開には次の条件を満たす必要があります。

- 最低対応 macOS を決定し、対象環境で起動、コマンド、対話入力、キャンセル、終了を検証する。
- Nix 環境外で実行し、GitHub Releases から取得したファイルのインストールと更新を検証する。
- Developer ID 署名・公証の採否を決定する。採用する場合は最終バイナリへ適用・検証してからチェックサムを生成する。採用しない場合は対象 macOS の Gatekeeper の挙動と許可手順を検証し、制約と手順をリリース本文へ記載する。
- レビュー済みコミットとクリーンな作業ツリーから生成し、依存監査、CI の ARM64 実行結果、成果物と `BUILD_INFO` の整合、最終バイナリのチェックサムを確認する。
- 公開先の権限とリリース承認を確認し、バイナリ、チェックサム、ビルド情報を一組で公開する。
