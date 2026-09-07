# wts

`wts`（Git Worktree Session）は、Apple Silicon macOS 向けのコマンドラインツールです。ヘルプ、バージョン表示、実行環境を表示する `doctor` コマンドを提供します。Git worktree の作成・切り替え・削除やセッション管理は提供していません。

## 対応環境と配布

[GitHub Releases](https://github.com/9uiLe/wts/releases) で検証用の Pre-release を配布します。対象は Apple Silicon macOS です。最低対応 macOS は未確定で、GitHub Actions の macOS 15 ARM64 上で起動を検証します。Intel Mac、Linux、Windows は対象外です。

Developer ID 署名・公証は行っていません。ダウンロードしたバイナリは Gatekeeper によって起動が制限される場合があり、その許可手順は未検証です。チェックサムの一致は起動制限を解消しません。利用前に各 Release の説明と `BUILD_INFO` で検証範囲を確認してください。

CLI の実行に外部コマンド、設定ファイル、追加の環境変数、ネットワーク接続は必要ありません。単体実行ファイルに Bun ランタイムを含むため、Nix、Bun、Node.js のインストールも不要です。

## リポジトリの取得

配布バイナリのインストールとソースからのビルドには、リポジトリにある独立したスクリプトを使用します。まず Git でリポジトリを取得してください。以降のコマンド例は、そのルートディレクトリで実行します。

```bash
git clone https://github.com/9uiLe/wts.git
cd wts
```

## 配布バイナリのインストール・更新

同じ [Pre-release](https://github.com/9uiLe/wts/releases) の `wts-macos-arm64`、`wts-macos-arm64.sha256`、`BUILD_INFO` を同じディレクトリへダウンロードし、その場所を指定します。

```bash
./scripts/install.sh /path/to/downloads
"$HOME/.local/bin/wts" --version
"$HOME/.local/bin/wts" --help
```

スクリプトは Apple Silicon macOS と成果物の存在、バイナリの SHA-256 を確認し、成功した場合に `~/.local/bin/wts` へ配置します。Nix は不要です。配置先を変更する場合は第2引数でディレクトリを指定します。

更新時は実行中の `wts` を終了し、更新先の Pre-release から取得した成果物に対して同じコマンドを実行します。

## ソースからのビルド・インストール

Apple Silicon Mac に Nix と Xcode Command Line Tools を用意し、[開発環境の前提](docs/development.md#開発環境)を満たしたうえで実行します。

```bash
./scripts/setup.sh
./scripts/build.sh
./scripts/install.sh
"$HOME/.local/bin/wts" --version
```

セットアップで固定された開発環境と依存を確認し、ビルドで `release/` に成果物を生成・検証します。引数なしの `install.sh` はこの成果物を配置します。バージョン指定や成果物の内容は [ビルド資料](docs/development.md#ビルド成果物)を参照してください。

## PATH の設定

`~/.local/bin` が PATH にない場合は `~/.zshrc` に次を追加し、シェルを再起動してください。別の配置先を指定した場合は、そのディレクトリを追加します。

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## よく使うスクリプト

| 操作 | コマンド |
| --- | --- |
| 初回セットアップ（環境確認・依存取得） | `./scripts/setup.sh` |
| 依存のインストール | `./scripts/install-deps.sh` |
| ソースから実行 | `./scripts/dev.sh --help` |
| 成果物のビルド・検証 | `./scripts/build.sh` |
| 整形・lint・型・テスト・ビルドと成果物の検証 | `./scripts/check.sh` |
| 成果物のインストール・更新 | `./scripts/install.sh [成果物ディレクトリ] [配置先ディレクトリ]` |

開発用スクリプトは固定された Nix 環境を使用します。`install.sh` は macOS の標準コマンドで実行します。どのスクリプトも、そのパスを指定すれば別のディレクトリから実行できます。引数と個別の検査方法は [開発コマンド](docs/development.md#開発コマンド)に記載しています。

## 使い方

```bash
wts --help
wts --version
wts doctor
wts doctor --interactive
```

| 引数 | 振る舞い |
| --- | --- |
| `--help` | コマンドとオプションを表示する |
| `--version` | wts のバージョンを表示する |
| `doctor` | バージョン、OS、CPU アーキテクチャを標準出力へ表示する |
| `doctor --interactive` | 確認を求め、肯定された場合に OS と CPU アーキテクチャを表示する |

対話モードでは標準入力と標準出力の両方に TTY が必要です。否定回答と Ctrl-C によるキャンセルは終了コード `0` で終了します。TTY がない場合と未知のコマンドは標準エラーへエラーを表示し、終了コード `1` で終了します。

`doctor` は実行プロセスの環境を表示するコマンドです。開発ツールのインストール状態や、対応 OS の条件を満たしているかどうかは判定しません。

## 開発資料

- [開発環境・検証・ビルド・公開手順](docs/development.md)
- [責務・バージョン・公開判定の設計](docs/design.md)
- [変更時の作業規約](AGENTS.md)

## ライセンス

wts は [MIT License](LICENSE) で提供します。著作権者は 9uiLe です。依存ソフトウェアには、それぞれのライセンスが適用されます。
