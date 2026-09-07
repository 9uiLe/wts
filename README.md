# wts

`wts`（Git Worktree Session）は、Apple Silicon macOS 向けのコマンドラインツールです。ヘルプ、バージョン表示、実行環境を表示する `doctor` コマンドを提供します。Git worktree の作成・切り替え・削除やセッション管理は提供していません。

## 対応環境と配布

[GitHub Releases](https://github.com/9uiLe/wts/releases) で検証用の Pre-release を配布します。対象は Apple Silicon macOS です。最低対応 macOS は未確定で、GitHub Actions の macOS 15 ARM64 上で起動を検証します。Intel Mac、Linux、Windows は対象外です。

Developer ID 署名・公証は行っていません。ダウンロードしたバイナリは Gatekeeper によって起動が制限される場合があり、その許可手順は未検証です。チェックサムの一致は起動制限を解消しません。利用前に各 Release の説明と `BUILD_INFO` で検証範囲を確認してください。

CLI の実行に外部コマンド、設定ファイル、追加の環境変数、ネットワーク接続は必要ありません。単体実行ファイルに Bun ランタイムを含むため、Nix、Bun、Node.js のインストールも不要です。

## 検証用バイナリの導入・更新

同じ Pre-release の `wts-macos-arm64`、`wts-macos-arm64.sha256`、`BUILD_INFO` を同じディレクトリへダウンロードし、そのディレクトリでチェックサムを照合します。

```bash
shasum -a 256 -c ./wts-macos-arm64.sha256
```

照合に成功した場合に配置してください。失敗した場合は導入・更新を中止します。

```bash
mkdir -p "$HOME/.local/bin"
install -m 755 ./wts-macos-arm64 "$HOME/.local/bin/wts"
"$HOME/.local/bin/wts" --version
"$HOME/.local/bin/wts" --help
```

`~/.local/bin` が PATH にない場合は `~/.zshrc` に次を追加し、シェルを再起動してください。

```bash
export PATH="$HOME/.local/bin:$PATH"
```

更新時は実行中の `wts` を終了し、更新先の Pre-release に対して同じ取得・照合・配置手順を実行します。

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
