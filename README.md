# wts

`wts`（Git Worktree Session）は、Apple Silicon macOS 向けのコマンドラインツールです。ヘルプ、バージョン表示、実行環境を表示する `doctor` コマンドを提供します。Git worktree の作成・切り替え・削除やセッション管理は提供していません。

## 対応環境と配布

[GitHub Releases](https://github.com/9uiLe/wts/releases) で検証用の Pre-release を配布します。対象は Apple Silicon macOS です。最低対応 macOS は未確定で、GitHub Actions の macOS 15 ARM64 上で起動を検証します。Intel Mac、Linux、Windows は対象外です。

Developer ID 署名・公証は行っていません。ダウンロードしたバイナリは Gatekeeper によって起動が制限される場合があり、その許可手順は未検証です。チェックサムの一致は起動制限を解消しません。利用前に各 Release の説明と `BUILD_INFO` で検証範囲を確認してください。

CLI の実行に外部コマンド、設定ファイル、追加の環境変数、ネットワーク接続は必要ありません。単体実行ファイルに Bun ランタイムを含むため、Nix、Bun、Node.js のインストールも不要です。

## 検証用バイナリの導入・更新

リポジトリのスクリプトを使って導入・更新できます。まずリポジトリを取得します。

```bash
git clone https://github.com/9uiLe/wts.git
cd wts
```

同じ Pre-release の `wts-macos-arm64`、`wts-macos-arm64.sha256`、`BUILD_INFO` を同じディレクトリへダウンロードし、その場所を指定してください。

```bash
./scripts/install.sh /path/to/downloads
"$HOME/.local/bin/wts" --version
"$HOME/.local/bin/wts" --help
```

`install.sh` は必要ファイルとチェックサムを確認し、成功した場合に `~/.local/bin/wts` へ配置します。Nix は不要です。第2引数で配置先ディレクトリを指定できます。更新にも同じコマンドを使用します。

`~/.local/bin` が PATH にない場合は `~/.zshrc` に次を追加し、シェルを再起動してください。

```bash
export PATH="$HOME/.local/bin:$PATH"
```

更新時は実行中の `wts` を終了し、更新先の Pre-release に対して同じ取得・照合・配置手順を実行します。

## よく使うスクリプト

ソースから実行・ビルドする場合は、Apple Silicon Mac に Nix と Xcode Command Line Tools を用意してください。[開発環境の前提](docs/development.md#開発環境)を満たしたうえで、リポジトリのルートから次のスクリプトを実行します。開発操作は固定された Nix 環境を自動で使用します。

| 操作 | コマンド |
| --- | --- |
| 初回セットアップ（環境確認・依存取得） | `./scripts/setup.sh` |
| 依存のインストール | `./scripts/install-deps.sh` |
| ソースから実行 | `./scripts/dev.sh --help` |
| 成果物のビルド・チェックサム照合 | `./scripts/build.sh` |
| 整形・lint・型・テスト・ビルドの検証 | `./scripts/check.sh` |
| ビルドした成果物をローカルへ配置 | `./scripts/install.sh` |

初回は `setup.sh`、`build.sh`、`install.sh` の順に実行します。バージョンを指定するビルドは `WTS_RELEASE_VERSION=0.2.0-rc.1 ./scripts/build.sh` です。成果物は `release/` に生成します。スクリプトのパスを指定すれば別のディレクトリからも実行できます。

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
