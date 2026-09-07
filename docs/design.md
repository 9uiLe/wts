# wts の設計

## 目的と範囲

wts（Git Worktree Session）は、Apple Silicon macOS 向けの CLI と、その検証・配布基盤である。CLI はヘルプ、バージョン表示、`init`、`doctor`、`config check` と Git worktree セッション・スタック操作を提供する。配布基盤は固定された開発環境で単体実行ファイルを生成し、GitHub Releases に検証用 Pre-release として公開する。

Intel Mac・Linux・Windows への対応、自動更新、OS 向けインストーラーパッケージ、署名・公証の自動化、Nix パッケージとしての配布は対象外とする。利用方法は [README](../README.md)、開発・公開操作は [開発資料](development.md)、作業規約は [AGENTS.md](../AGENTS.md) に定義する。

## 実行の階層

操作の入口、開発処理、配布 CLI を分ける。利用者と CI は独立したシェルスクリプトを呼び出し、開発処理は固定 Nix 環境の Bun で実行する。生成バイナリは Bun ランタイムを含み、CLI の利用者には開発環境を要求しない。

### 操作の入口

| 実装 | 責務 |
| --- | --- |
| `scripts/setup.sh` | Apple Silicon macOS、Nix、Xcode Command Line Tools と Flake を確認し、依存取得を呼び出す |
| `scripts/install-deps.sh` | ロックを更新せず、インストールスクリプトを無効にして依存を取得する |
| `scripts/dev.sh` | CLI 引数をソース実行へ渡す |
| `scripts/check-config.sh` | 呼び出し元ディレクトリを保ってプロジェクト設定を検査する |
| `scripts/build.sh` | ビルド処理を呼び出し、配布する成果物を検証する |
| `scripts/check.sh` | 整形・lint・型・テスト・ビルドを呼び出し、配布する成果物を検証する |
| `scripts/install.sh` | 成果物を検証し、任意の --with-deps で Git・gh を導入してから指定ディレクトリへ実行ファイルを配置する |
| `scripts/lib/artifacts.sh` | 各入口から source して使う内部共通処理として、成果物の検証を提供する（直接実行しない） |

開発用の入口は wts リポジトリの Flake を選び、`nix develop --no-update-lock-file` で固定環境を使用する。設定検査は対象プロジェクトを探すため呼び出し元ディレクトリを保持する。配置用の入口は macOS の標準コマンドを使用し、相対パスの引数を呼び出し時のディレクトリから解釈する。引数・既定値と操作手順は [開発資料](development.md#開発コマンド)に定義する。

### 開発処理と環境

| 実装・設定 | 責務 |
| --- | --- |
| `flake.nix`、`flake.lock` | `aarch64-darwin` 向けの Bun、Git、OSV-Scanner、Coreutils と Nixpkgs の入力を固定する |
| `package.json`、`bun.lock`、`bunfig.toml` | 開発コマンド、直接依存、推移的依存、npm レジストリを定義する |
| `biome.json`、`tsconfig.json` | 整形、lint、型の検査規則を定義する |
| `tests/` | CLI、バージョン、公開判定、インストールの振る舞いを検証する |
| `scripts/verify-dependencies.sh`、`scripts/dependency-inventory.ts` | 固定依存の取得、依存一覧と監査結果の生成を行う |
| `scripts/build.ts` | バイナリの生成・起動検証、チェックサムとビルド情報の記録を行う |
| `scripts/release-version.ts` | ビルドと公開判定で共有する SemVer 入力を検証する |
| `scripts/check-release.ts` | 入力バージョン、master、公開済み Release、既存タグを検査する |

Nix は開発ツール、Bun は JavaScript / TypeScript の依存・実行・テスト・コンパイルを管理する。開発処理の依存は配布 CLI の実行要件には含めない。

### CLI とワークフロー

| 実装 | 責務 |
| --- | --- |
| `src/cli.ts` | Commander で引数を処理し、Clack で端末対話を行う |
| `src/doctor.ts` | 対応 OS・依存コマンド・GitHub 認証の検査と不足時の案内 |
| `src/session.ts` | Git 実行、リポジトリ・スタック探索、セッション識別情報、対話の共通処理 |
| `src/config.ts` | 設定ファイルの初期化と探索、項目とパスの検証、作成先の解決 |
| `src/naming.ts` | 日付＋UUID の生成、設定済みスクリプトとの入出力、名前の検証 |
| `src/start.ts` | セッションとスタックブランチの作成、管理外ファイルのコピー |
| `src/cleanup.ts` | マージ済み PR とローカル変更の証明に基づく整理 |
| `src/restack.ts` | スタックの rebase と lease を保持した atomic push |
| `src/version.ts` | CLI の表示バージョンを提供する |
| `.github/workflows/ci.yml` | 読み取り権限でソースと生成物を検証する |
| `.github/workflows/release.yml` | 手動入力から対象を確定し、検証済み成果物を Pre-release として公開する |

## セッションと設定の不変条件

公開するセッション操作は `start`、`stack`、`cleanup`、`restack` とする。対話の否定とキャンセルは正常終了し、非対話環境で必要な入力がない場合はエラーにする。外部コマンドは引数配列で実行する。

セッションは一つの worktree とルートブランチを持つ。`start` は worktree 専用の Git ディレクトリに `wts-session.json` を保存し、`rootBranch` を記録する。`stack`・`restack` は設定された作成先の範囲とこの情報を使ってセッションを識別する。ディレクトリ名からブランチ名を推測せず、手作業で作成した worktree をセッションとして扱わない。スタックの枝は `<root>-pr<n>-<名前>` で識別し、番号順に扱う。

`init` は実行中の worktree ルートに `.wts.json` を作成し、既存ファイルを上書きしない。初期設定は `worktreeDirectory` に `../<メインチェックアウトのディレクトリ名>-worktrees`、`naming` に空オブジェクトを記録する。

セッション操作とファイル指定なしの `config check` は `.wts.json` を必須とする。実行中の worktree、メインチェックアウトの順に探索し、最初の一つを使用する。両方にない場合はエラーにする。設定項目の省略には既定値を使い、複数ファイルのマージは行わない。相対の作成先はメインチェックアウト基準、相対のスクリプトパスは設定ファイル基準とする。項目、型、パス、実行権限の不正は操作を中止する。詳細なスキーマと入出力は [設定資料](configuration.md) に定義する。

既定の名前は日本時間の日付と UUID から生成する。命名スクリプトは設定した種類だけ実行し、作業内容・プロンプト・命名コンテキストを JSON 標準入力で渡す。プロンプト省略時は空文字を渡す。終了失敗や不正な出力は作成前のエラーとし、既定名への置換は行わない。ブランチ名と worktree 名は別々に検証し、衝突時は上書きしない。

`--dry-run` は wts による fetch、ブランチ・worktree・コピー・セッション情報・lease の変更と push を行わない。リモート参照、PR 情報の読み取り、予定名の生成は実行する。命名スクリプト自身の副作用は wts の制御範囲に含めない。

コピーは worktree と Git 管理情報の境界を検査し、シンボリックリンクを持ち込まない。cleanup はマージ済み PR とローカル変更の取り込みを証明できる候補だけを削除する。restack は線形かつ他の worktree で使用していないスタックを要求し、rebase 開始時のリモート OID を保存する。push は保存した OID を明示的な lease として使用し、atomic に実行する。

## 検査と導入の境界

`init`、`doctor`、ヘルプ、バージョン表示は設定ファイルを必要としない。ヘルプ、バージョン、オプションなしの `doctor` は外部コマンドも必要としない。`doctor --check` は対応 OS・Git・gh の実行と認証、任意の Claude CLI の有無を検査する。認証情報は表示せず、必須項目の失敗を終了コードに反映する。任意の命名スクリプトが利用する依存の検査は、そのスクリプト側で扱う。

`config check` は設定と実行権限を検証するが、命名スクリプトは実行しない。ファイルを明示した場合は Git リポジトリ外でも検査できる。いずれの検査も環境変更や認証操作は行わない。

`install.sh` は OS と成果物を検証した後、`--with-deps` 指定時だけ Homebrew に Git・gh の導入を委ねる。依存導入に失敗した場合は wts を配置しない。Homebrew 自体、命名スクリプト用の依存、認証の用意は利用者の責務とする。

## バージョン

ソース実行時は `package.json` のバージョンを表示する。ビルド時は `WTS_RELEASE_VERSION` が指定されていればその SemVer を、未指定なら `package.json` のバージョンを使用する。先頭 `v`、不正な識別子、余分な空白を含む入力は拒否する。

ビルドで選んだ値を `WTS_BUILD_VERSION` としてコンパイル時に埋め込み、バイナリの表示と `BUILD_INFO` に同じ値を使用する。実行時の環境変数は配布バイナリのバージョンを変更しない。公開のために `package.json` とロックファイルを書き換える必要はない。

## 検証と依存監査

Biome の既定 formatter と recommended lint、TypeScript の `tsc --noEmit`、Bun のテスト、生成バイナリの起動検証をそれぞれの責務として分ける。`bun run check` は整形検査、lint、型検査、テスト、ビルドを順に実行する。

依存は `--frozen-lockfile --ignore-scripts` でインストールする。依存一覧にはロック内の取得先と SHA-512 integrity の有無、取得済みパッケージのバージョン、公開元、ライセンス、インストールスクリプトを記録する。別 OS 向けの optional dependencies など、未インストールの項目は `installed: false` とする。

既知の脆弱性は `bun audit` と OSV-Scanner へ照会し、両方の終了コードが `0` の場合に成功とする。照会日時、ツール、取得先、終了コード、例外、結果、標準エラーを監査資料へ記録する。API が公開しないデータベースのスナップショット日時は推定しない。依存一覧と監査結果は、ソースコード全体の安全性やライセンス適合性の承認を意味しない。

## 成果物の契約

ビルドと起動検証の実行環境は Apple Silicon macOS、コンパイル先は `bun-darwin-arm64` とする。生成したバイナリのバージョン一致、ヘルプの CLI 名、`doctor` の正常終了を確認してから配布用ディレクトリへコピーする。

配布単位はバイナリ、SHA-256、`BUILD_INFO` の組とする。`scripts/lib/artifacts.sh` は各ファイルの存在とバイナリの SHA-256 を検証し、ビルド・検査・配置の入口が同じ条件を使用する。チェックサムの対象名にはバイナリの basename を用い、取得先の同じディレクトリで照合できる形式にする。成果物のパスと照合操作は [開発資料](development.md#ビルド成果物) に記載する。

`BUILD_INFO` は生成日時、バージョン、Git コミット、作業ツリーの状態、Bun・Nix・OS・Xcode Command Line Tools、ターゲット、ロックファイルの SHA-256、最低対応 macOS、署名・公証、外部要件を記録する。変更のある作業ツリーから生成した場合は `git_worktree=dirty` とし、コミットだけで生成元を特定できるとは扱わない。

成果物は常に `build_kind=verification_only` とする。最低対応 macOS は未確定で、Developer ID 署名・公証は行わない。GitHub Actions での起動検証と、ダウンロードしたファイルの Gatekeeper を含む検証は別の証拠として扱う。正式公開の条件は [開発資料](development.md#正式リリースの条件) に定義する。

## 公開判定

Release ワークフローは `master` を選択した手動実行だけを受け付ける。入力は先頭 `v` なしの SemVer とし、タグ名を `v<version>` とする。入力にプレリリース識別子があるかどうかによらず、GitHub 上の公開状態は Pre-release に固定する。

対象コミットはチェックアウトした最新 `master` の HEAD とする。ビルド前後に GitHub API で次を検査する。

- リモートの `master` と HEAD が一致する。`master` が進んでいる場合はエラーにする。
- Release 一覧の全ページから、下書きを除き `published_at` が最大の Release を選ぶ。Pre-release も含み、GitHub の「Latest」ラベルやバージョン番号順は使用しない。
- 最新公開 Release のタグをコミット SHA に解決し、`master` と一致すればエラーにする。注釈付きタグも同じ比較を行う。公開済み Release がない場合は初回公開を許可する。
- 入力から生成したタグ、または同じタグ名の Release が存在すればエラーにする。Release の重複判定には下書きも含める。

API の認証・通信・タグ解決の失敗は判定失敗として扱い、公開へ進めない。

## 公開の境界

通常の CI は `contents: read` で検証を行う。Release ワークフローでは公開ジョブだけに `contents: write` を与え、`GITHUB_TOKEN` でタグと Release を作成する。GitHub Actions の参照はコミット SHA に固定する。

公開処理は確定したコミットにタグを作成し、成果物を下書き Release に添付した後、Pre-release として公開する。GitHub の「Latest」には指定しない。失敗時に残った下書きやタグは自動で削除・上書きせず、次の実行でも重複判定の対象とする。

同じ Release ワークフローの実行は直列化する。公開直前の再検査はビルド中の更新を検出するが、検査と公開を単一のトランザクションにはしない。公開対象には検証したコミット SHA を明示し、その後のブランチ更新によって対象が変わらないようにする。
