# wts

`wts`（Git Worktree Session）は、Apple Silicon Mac 向けのコマンドラインツールです。ヘルプ、バージョン表示、実行環境を表示する `doctor` コマンドを提供します。Git worktree の作成・切り替え・削除やセッション管理は提供していません。

## 対応環境と配布状態

対象は Apple Silicon macOS です。最低対応 macOS バージョンは未確定で、生成物は検証用として扱います。Intel Mac、Linux、Windows は対象外です。

検証用バイナリには Developer ID 署名・公証を行っていないため、Gatekeeper によって起動が制限される場合があります。正式配布物の対応環境と署名・公証の状態は、各リリースの説明を確認してください。

## インストール・更新

以下は正式リリースの公開後に使用する手順です。[GitHub Releases](https://github.com/9uiLe/wts/releases) で配布ファイルと対応 macOS を確認してください。検証用ビルドは正式配布物として扱いません。

同じリリースの `wts-macos-arm64`、`wts-macos-arm64.sha256`、`BUILD_INFO` を同じディレクトリへ取得し、そのディレクトリでチェックサムを照合します。

```bash
shasum -a 256 -c ./wts-macos-arm64.sha256
```

署名・公証が提供される場合はリリース本文の検証手順にも従います。すべての検証に成功した場合に配置してください。検証に失敗した場合はインストール・更新を中止します。

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

更新時は実行中の `wts` を終了し、新しいリリースのファイルに対して同じ取得・検証・配置手順を実行します。

## 使い方

インストール後、ターミナルで実行してください。

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

対話モードでは標準入力と標準出力の両方に TTY が必要です。否定回答と Ctrl-C によるキャンセルは終了コード `0`、TTY がない場合と未知のコマンドは標準エラーへエラーを表示して終了コード `1` で終了します。

CLI の実行に外部コマンド、設定ファイル、追加の環境変数、ネットワーク接続は必要ありません。単体実行ファイルには Bun ランタイムを同梱するため、利用者側で Nix、Bun、Node.js を用意する必要もありません。

## 開発資料

- [開発環境の構築・検証・ビルド・リリース手順](docs/development.md)
- [設計と構成](docs/design.md)
