# wts の設計

## 目的と範囲

wts（Git Worktree Session）は、Apple Silicon macOS 向けの CLI と、その検証・配布基盤である。CLI はヘルプ、バージョン表示、実行環境を表示する `doctor` を提供する。配布基盤は固定された開発環境で単体実行ファイルを生成し、GitHub Releases に検証用 Pre-release として公開する。

Git worktree 操作、セッション管理、Intel Mac・Linux・Windows への対応、自動更新、OS 向けインストーラーパッケージ、署名・公証の自動化、Nix パッケージとしての配布は対象外とする。利用方法は [README](../README.md)、開発・公開操作は [開発資料](development.md)、作業規約は [AGENTS.md](../AGENTS.md) に定義する。

## 実行の階層

操作の入口、開発処理、配布 CLI を分ける。利用者と CI は独立したシェルスクリプトを呼び出し、開発処理は固定 Nix 環境の Bun で実行する。生成バイナリは Bun ランタイムを含み、CLI の利用者には開発環境を要求しない。

### 操作の入口

| 実装 | 責務 |
| --- | --- |
| `scripts/setup.sh` | Apple Silicon macOS、Nix、Xcode Command Line Tools と Flake を確認し、依存取得を呼び出す |
| `scripts/install-deps.sh` | ロックを更新せず、インストールスクリプトを無効にして依存を取得する |
| `scripts/dev.sh` | CLI 引数をソース実行へ渡す |
| `scripts/build.sh` | ビルド処理を呼び出し、配布する成果物を検証する |
| `scripts/check.sh` | 整形・lint・型・テスト・ビルドを呼び出し、配布する成果物を検証する |
| `scripts/install.sh` | 成果物を検証し、指定ディレクトリへ実行ファイルを配置する |
| `scripts/lib/artifacts.sh` | 各入口から source して使う内部共通処理として、成果物の検証を提供する（直接実行しない） |

開発用の入口はリポジトリを基準に処理し、`nix develop --no-update-lock-file` で固定環境を使用する。配置用の入口は macOS の標準コマンドを使用し、相対パスの引数を呼び出し時のディレクトリから解釈する。引数・既定値と操作手順は [開発資料](development.md#開発コマンド)に定義する。

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
| `src/version.ts` | CLI の表示バージョンを提供する |
| `.github/workflows/ci.yml` | 読み取り権限でソースと生成物を検証する |
| `.github/workflows/release.yml` | 手動入力から対象を確定し、検証済み成果物を Pre-release として公開する |

## CLI とバージョン

CLI は外部コマンド、設定ファイル、追加の環境変数、ネットワーク接続を要求しない。コマンドの出力、対話の TTY 条件、キャンセルとエラーの終了コードは [README](../README.md#使い方) に定義する。

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
