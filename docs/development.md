# wts の開発とリリース

このリポジトリでは、プロジェクト設定に基づく wts のセッションを使って開発します。本書は、新しいチェックアウトから開発を始め、変更を検証し、成果物を生成・公開するまでの手順を定義します。利用方法と配布状態は [README](../README.md)、実装の責務と公開判定は [設計書](design.md)、選択理由は [設計判断](decisions.md)、変更時の規約は [AGENTS.md](../AGENTS.md) を参照してください。

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

## 開発セッション

### 設定と作成元

メインチェックアウトはリポジトリを clone したディレクトリです。作業用 worktree は、その隣の `wts-worktrees` ディレクトリに作成します。リポジトリで管理する `.wts.json` が、この配置とベースブランチ `master`、日付＋UUID の既定命名を指定しています。

`start` は `origin/master` からセッションを作成し、`restack` は同じ参照から更新を取り込みます。`cleanup` は `master` を削除対象から除き、`origin/master` への取り込み状況を調べます。別のベースを使う操作では `start`・`restack` の `--base-branch` を指定できます。設定の契約と優先順位は [設定資料](configuration.md) を参照してください。

### セッションを作成する

開発環境を用意したメインチェックアウトから、設定と作成予定を確認してセッションを作成します。`./scripts/dev.sh` は固定 Nix 環境で、そのスクリプトが属するチェックアウトのソースを実行します。バイナリのビルドやインストールは不要です。

```bash
./scripts/dev.sh config check
./scripts/dev.sh start --dry-run
./scripts/dev.sh start
```

作成される worktree のソースと `.wts.json` は、ベースのコミットに含まれるものです。作成結果の `Path` へ `cd` し、その worktree にある `./scripts/setup.sh` を実行してください。`node_modules` は Git 管理しないため、worktree ごとに固定依存を取得します。以降のソース実行と検証には、作業中の worktree にあるスクリプトを使います。

### 変更を積み、ベースの更新を取り込む

変更は [開発コマンド](#開発コマンド) と [検証手順](#検証を実行する) に従って検証し、目的が共通する実装・テスト・文書を一つの変更単位としてコミットします。PR の記載項目は [PR テンプレート](../.github/PULL_REQUEST_TEMPLATE.md) に従ってください。

同じ worktree で次の変更を別ブランチに積む場合は `stack` を使います。現在のブランチがスタックの先端で、未コミット変更がないことが必要です。最初の追加ブランチの番号は `2` です。

```bash
./scripts/dev.sh stack --pr-number 2
```

`master` の更新をスタックへ取り込む場合は `restack` を使います。rebase 後の origin への push は対話で確認します。PR の作成・マージは GitHub または gh で行ってください。

```bash
./scripts/dev.sh restack
```

### マージ済みのセッションを整理する

メインチェックアウトへ戻り、削除予定を確認してから整理します。削除対象の worktree にある未コミット変更や管理外ファイルは保持されないため、必要な内容は事前に保存してください。

```bash
./scripts/dev.sh cleanup --dry-run
./scripts/dev.sh cleanup
```

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

端末 UI のレビューには、実 CLI の表示を収録した静的 HTML を使います。全件一覧でコマンド間の一貫性を、変更一覧で採用済みの表示との差分を確認します。リポジトリのルートから固定 devShell で生成してください。

```bash
nix develop --no-update-lock-file --command bun run ui:catalog
```

#### レビュー画面

`release/ui-catalog/index.html` をブラウザーで開きます。各 HTML に画面と操作機能を含むため、サーバーを用意せず単体で共有できます。CI で生成したファイルは、Actions の `terminal-ui-review` アーティファクトから取得できます。

上部の件数付きボタンで「全件」と「変更のみ」を切り替えます。ケース名・コマンド・出力の検索と、コマンドによる絞り込みを併用できます。選択した範囲の件数と、絞り込み後の表示件数を確認してください。

| ケースの状態 | 表示 |
| --- | --- |
| 変更なし | 「出力」を1画面で表示 |
| 変更あり | 「変更前」「変更後」を並べ、変更行を強調 |
| 追加 | 追加された出力を表示 |
| 削除 | 削除された出力を表示 |

各ケースでは実行コマンド、入力、終了コード、最終画面を確認できます。対話の選択肢や入力待ちの表示は「入力前」を開いて確認してください。変更が0件の場合は「全件を表示」、検索や絞り込みに一致しない場合は「絞り込みを解除」から一覧へ戻れます。

#### 生成ファイル

既定の出力先は `release/ui-catalog/` です。HTML は表示レビュー用、JSON と Markdown は実行結果や収録条件の調査用です。

| ファイル | 内容 |
| --- | --- |
| `index.html` | 「全件」を初期表示するレビュー画面 |
| `changes.html` | 「変更のみ」を初期表示するレビュー画面 |
| `captures.json` | 実行時の端末出力、入力、コマンド、終了コード |
| `comparison.json` | ケースごとの変更判定 |
| `coverage.md` | 収録条件、疑似応答を使う範囲、未実測の条件 |

生成が失敗すると終了コード `1` を返し、HTML に診断を表示します。`failure.txt` で失敗内容、`partial-captures.json` で収録済みケースを調べてください。

#### 基準版の採用

`tests/fixtures/ui-baseline.json` は、担当者が採用した表示を保存する Git 管理の基準版です。一時パスや生成名などを正規化して保存します。通常の生成はこの基準版と比較し、差分の有無にかかわらず収録が成功すれば終了コード `0` を返します。

1. UI を変更し、カタログを生成します。
2. 「変更のみ」で文言、配色、入力前画面、終了コードを確認し、「全件」で全体の表示を確認します。
3. 採用する表示が確定したら、次のコマンドで基準版を更新します。

```bash
nix develop --no-update-lock-file --command bun run ui:catalog --update-baseline tests/fixtures/ui-baseline.json
nix develop --no-update-lock-file --command bun run format
```

UI と基準版を同じ変更単位でコミットしてください。基準版を更新した実行の HTML は、更新前の基準との比較結果です。通常の生成を再実行すると、更新後の基準と比較します。

別の基準版や出力先を使う場合は、devShell 内で次のように指定します。

```bash
bun run ui:catalog --baseline /path/to/baseline.json --output release/ui-review
```

#### 収録条件とケースの追加

収録は 120 桁・40 行の Bun 擬似端末と一時 Git リポジトリを使います。この寸法はカタログの表示条件です。非 TTY のケースはパイプ出力を収録します。リモート操作にはローカル bare リポジトリを使い、GitHub 応答や障害はテスト用コマンドで再現します。

比較では一時パス、日付付き UUID、Git の OID などの可変値を正規化します。対象は文言・色・入力前画面・入力・実行コマンド・終了コードで、スピナーの描画回数は含めません。

ケースは `scripts/ui-catalog/` に定義します。コマンドや表示分岐を追加したら、到達条件と期待する終了コードを持つケースも追加してください。タイトルは基準版との対応キーなので、表示文言の変更だけでは変更しません。条件を変えた場合はケースの追加・削除としてレビューします。

収録対象は列挙した表示分岐です。実サービスへの接続、可変値の全組合せ、OS・Git の診断文の全種類は対象外です。glob 走査例外と lease 削除時の OS 例外、および通常到達しない防御的分岐は未実測として扱います。具体的な条件は生成された `coverage.md` で確認してください。

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
