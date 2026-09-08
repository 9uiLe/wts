# wts の開発とリリース

開発者向けに、環境構築、検証、成果物の生成、GitHub Actions からの Pre-release 公開を説明します。利用方法と配布状態は [README](../README.md)、実装の責務と公開判定は [設計書](design.md)、選択理由は [設計判断](decisions.md)、変更時の規約は [AGENTS.md](../AGENTS.md) を参照してください。

## 開発環境

Apple Silicon Mac、Xcode Command Line Tools、`nix-command` と `flakes` を有効にした Nix が必要です。依存の取得と監査にはネットワーク接続を使用します。

リポジトリを取得し、ルートディレクトリでセットアップと検証を実行します。

```bash
git clone https://github.com/9uiLe/wts.git
cd wts
./scripts/setup.sh
nix develop --no-update-lock-file --command bun run verify:deps
./scripts/check.sh
```

Nix Flakes は Bun、Git、OSV-Scanner、Coreutils を提供し、Bun は JavaScript / TypeScript の依存を管理します。ツールは `flake.lock`、パッケージは `bun.lock` で固定します。通常の開発と CI ではロックファイルを更新せず、devShell の Bun を使用してください。インストール時のスクリプトは実行しません。

`setup.sh` は Apple Silicon macOS、Nix、Xcode Command Line Tools の存在を確認し、Flake を検査してから `install-deps.sh` で依存を取得します。Nix や Xcode Command Line Tools 自体のインストールは行いません。依存取得だけを再実行する場合は `./scripts/install-deps.sh` を使用します。

## 開発コマンド

各スクリプトは自身の位置から wts リポジトリと固定 Nix 環境を特定します。設定検査は呼び出し元のプロジェクトを対象とするため、現在のディレクトリを保持します。

| スクリプト | 用途・引数 |
| --- | --- |
| `./scripts/setup.sh` | 開発環境の確認と依存取得。引数なし |
| `./scripts/install-deps.sh` | 固定依存の取得。引数なし |
| `./scripts/dev.sh [CLI引数…]` | ソースから CLI を実行 |
| `./scripts/check-config.sh [設定ファイル]` | 呼び出し元プロジェクトまたは指定ファイルの設定検査 |
| `./scripts/build.sh` | ビルドと成果物検証。引数なし |
| `./scripts/check.sh` | 整形・lint・型・テスト・ビルドと成果物検証。引数なし |
| `./scripts/install.sh [--with-deps] [成果物ディレクトリ] [配置先ディレクトリ]` | 配布バイナリを配置 |

`check-config.sh` は任意のプロジェクトから絶対パスで呼び出せます。検査対象・設定の必須条件・検査範囲は [設定資料](configuration.md#設定の検査)を参照してください。`install.sh` は Nix を必要とせず、macOS の標準コマンドを使用します。引数の既定値は [ビルド成果物](#ビルド成果物)に記載しています。

スクリプトから呼び出す処理と個別の検査は `package.json` に定義しています。個別に実行する場合は `nix develop --no-update-lock-file` で devShell を開き、以下のコマンドを使用します。

| コマンド | 処理 |
| --- | --- |
| `bun run dev` | ソースから CLI を起動する。後ろに `--help`、`--version`、`doctor` などの引数を渡す |
| `bun run format` | Biome で整形し、ファイルを更新する |
| `bun run format:check` | ファイルを変更せずに整形規則を検査する |
| `bun run lint` | Biome の recommended ルールで静的検査する |
| `bun run typecheck` | `tsc --noEmit` で型を検査する |
| `bun run test` | CLI、初期化・設定・命名、セッション操作、環境検査、バージョン、公開判定、インストールの振る舞いをテストする |
| `bun run ui:catalog` | 全コマンドの出力を収録し、全件と基準版との差分を静的 HTML に生成する |
| `bun run verify:deps` | 固定依存をインストールし、依存一覧と監査結果を生成する |
| `bun run build` | Apple Silicon 向けバイナリを生成し、起動を検証する |
| `bun run check` | 整形検査、lint、型チェック、テスト、ビルドを順に実行する |

## 検証を実行する

整形と lint の対象・規則は `biome.json`、型検査の設定は `tsconfig.json` で定義します。対話を変更した場合は TTY 上で `bun run dev doctor --interactive` を実行し、肯定入力、否定入力、Ctrl-C によるキャンセルを確認してください。出力と終了コードは [README](../README.md#環境の検査) に記載しています。

設定・命名は一時ディレクトリとテスト用スクリプトで、セッション操作は一時 Git リポジトリと bare origin で検証します。外部サービスの応答や Homebrew はテスト用コマンドを使い、通常の自動テストで実サービスへの認証やシステムへの依存導入を行いません。実サービスへの接続やダウンロード後の起動を検証した場合は、自動テストとは分けて結果を記録してください。

### 端末 UI の一覧と変更確認

端末 UI のレビューには、実 CLI の出力を収録した静的カタログを使います。固定 devShell で生成します。

```bash
nix develop --no-update-lock-file --command bun run ui:catalog
```

生成先は `release/ui-catalog/` です。

| ファイル | 用途 |
| --- | --- |
| `index.html` | 全ケースのコマンド、入力、終了コード、入力前画面、最終画面を確認する |
| `changes.html` | 基準版との差分があるケースに絞り、変更前後と追加・削除を確認する |
| `captures.json` | 実行時の端末出力と入力を確認する |
| `comparison.json` | ケースごとの変更有無と終了コードを機械的に確認する |
| `coverage.md` | 収録条件、疑似応答を使う範囲、未実測の条件を確認する |

HTML はサーバーや外部 CDN を必要とせず、ブラウザーで開けます。同じディレクトリのファイルを一緒に共有してください。CI の生成物は Actions の `terminal-ui-review` アーティファクトから取得できます。

基準版は `tests/fixtures/ui-baseline.json` に保存した採用済みの表示です。一時パスや生成名などの可変値を正規化して保存します。実行時の出力を保持する `captures.json` とは用途が異なります。通常の生成は基準版を変更せず、差分があること自体は失敗にしません。担当者は全件一覧で表示の一貫性を、変更一覧で変更内容を確認します。表示を採用したら、基準版を更新して関連する UI 変更と一緒にコミットします。

```bash
# devShell 内で別の基準版・出力先を指定する
bun run ui:catalog --baseline /path/to/baseline.json --output release/ui-review

# レビュー済みの表示を収録し、基準版を更新する
bun run ui:catalog --update-baseline tests/fixtures/ui-baseline.json
```

基準版を更新した実行の HTML は、更新前の基準との比較結果です。更新後の基準に対して再生成すると、同じ表示のケースには差分が出ません。生成が失敗した場合は終了コード `1` となり、一覧ページに診断を表示します。`failure.txt` と `partial-captures.json` で失敗の内容と収録済みのケースを確認してください。

収録は 120 桁・40 行の Bun 擬似端末と一時 Git リポジトリを使います。この寸法はカタログの表示条件であり、CLI の画面サイズを制限しません。リモート操作にはローカル bare リポジトリを使い、GitHub 応答や障害はテスト用コマンドで再現します。実サービスへ push・削除しません。パス、日付付き UUID、Git の OID などを正規化し、スピナーの描画回数が変わっただけでは差分にしません。色・文言・入力前画面・終了コードの変更は比較対象です。

ケースは `scripts/ui-catalog/` に定義します。コマンドや表示分岐を追加したら、到達条件と期待する終了コードを持つケースも追加してください。タイトルは基準版との対応キーなので、表示文言の変更だけでは変更しません。条件を変えた場合はケースの追加・削除としてレビューします。可変値の全組合せや、OS・Git の診断文の全種類は列挙しません。glob 走査例外と lease 削除時の OS 例外、および通常到達しない防御的分岐は未実測として扱います。

### 依存の検証

依存追加・更新時は公開元、ライセンス、リリース履歴、既知の脆弱性、スクリプト、推移的依存、予期しない通信を確認し、更新理由を記録します。通常の取得は `bun install --frozen-lockfile --ignore-scripts` とし、未レビューの更新やインストールスクリプトの実行は行いません。

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

ローカル配置には `./scripts/install.sh [--with-deps] [成果物ディレクトリ] [配置先ディレクトリ]` を使用します。既定の成果物はリポジトリの `release/`、配置先は `~/.local/bin` です。指定した相対パスは呼び出し時のディレクトリを基準に解釈します。バイナリ・チェックサム・`BUILD_INFO` の存在とチェックサムを確認してから配置します。`--with-deps` 指定時は検証と配置の間に Homebrew の `brew install git gh` を実行します。Homebrew が利用できない場合と導入失敗時は配置を中止します。依存と認証の確認は `wts doctor --check` を使用します。署名・公証や Gatekeeper 許可は行いません。

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
