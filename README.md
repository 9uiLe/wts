# wts

wts（Git Worktree Session）は、作業用の Git worktree と、依存関係のあるブランチの列を管理する Apple Silicon macOS 向け CLI です。

`init` でプロジェクト設定を用意し、`start` で作業場所を作ります。作業を分けてレビューしたいときは `stack` でブランチを積み重ね、`restack` でベースの更新を取り込みます。マージ後は `cleanup` でブランチと worktree を整理します。

## インストール

配布バイナリには Bun ランタイムを含み、利用時に Nix・Bun・Node.js は不要です。Git を使用し、`restack` は Git 2.38 以上、`cleanup` は認証済み GitHub CLI（`gh`）を必要とします。fetch・PR 照会・push にはリモートへの接続が必要です。既定の命名には AI や外部の命名コマンドを使用しません。

配布バイナリの配置にはリポジトリのスクリプトを使用します。以下はリポジトリのルートで実行します。

```bash
git clone https://github.com/9uiLe/wts.git
cd wts
```

同じ [Pre-release](https://github.com/9uiLe/wts/releases) の `wts-macos-arm64`、`wts-macos-arm64.sha256`、`BUILD_INFO` を一つのディレクトリへダウンロードしてください。

```bash
./scripts/install.sh /path/to/downloads
"$HOME/.local/bin/wts" --version
```

Apple Silicon macOS、成果物の存在、バイナリの SHA-256 を検査し、成功時に `~/.local/bin/wts` へ配置します。配置先は第2引数で変更できます。更新時は実行中の wts を終了し、更新先の成果物に対して同じコマンドを実行します。

Git と gh も導入する場合は [Homebrew](https://brew.sh/) を用意してください。

```bash
./scripts/install.sh --with-deps /path/to/downloads
gh auth login
"$HOME/.local/bin/wts" doctor --check
```

`--with-deps` は成果物検証後に `brew install git gh` を実行し、成功時に wts を配置します。Homebrew の通常の install 動作に従って Git・gh とその依存を導入・更新します（[Homebrew の仕様](https://docs.brew.sh/Manpage#install-options-formulacask-)）。Homebrew がない場合や導入失敗時は wts を配置しません。Homebrew 自体、命名スクリプト用のコマンド、認証は自動設定しません。`--with-deps` を付けなければ依存の導入は行いません。

`~/.local/bin` が PATH にない場合は `~/.zshrc` に次を追加し、シェルを再起動してください。別の配置先を使う場合はそのディレクトリを指定します。

```bash
export PATH="$HOME/.local/bin:$PATH"
```

ソースからビルドする場合は [開発環境の前提](docs/development.md#開発環境)を満たした Apple Silicon Mac で実行します。

```bash
./scripts/setup.sh
./scripts/build.sh
./scripts/install.sh
```

## 対応環境と配布状態

対象は Apple Silicon macOS です。[GitHub Releases](https://github.com/9uiLe/wts/releases) では検証用 Pre-release を配布します。最低対応 macOS は未確定で、GitHub Actions の macOS 15 ARM64 上で起動を検証します。Intel Mac、Linux、Windows は対象外です。

Developer ID 署名・公証は行っていません。ダウンロードしたバイナリは Gatekeeper によって起動が制限される場合があり、その許可手順は未検証です。チェックサムの一致は起動制限を解消しません。各 Release の説明と `BUILD_INFO` で検証範囲を確認してください。

## 環境の検査

```bash
wts doctor --check
```

対応 OS・CPU、Git 2.38 以上、gh の実行と認証、任意の Claude CLI の有無を検査し、OK・NG と対処方法を表示します。必須項目を満たせば終了コード `0`、不足や検査失敗があれば `1` です。Claude CLI は命名スクリプトで利用する場合だけ必要で、未導入でも検査は失敗しません。

Git リポジトリ外や非対話環境でも実行できます。認証確認には [`gh auth status`](https://cli.github.com/manual/gh_auth_status) を使うため、ネットワーク接続が必要です。認証情報は表示せず、インストール・ログイン・設定変更も行いません。任意の命名スクリプトが必要とする環境は、そのスクリプトの手順で確認してください。

| コマンド | 用途 |
| --- | --- |
| `wts --help` | コマンドとオプションの一覧 |
| `wts --version` | wts のバージョン |
| `wts doctor` | バージョン、OS、CPU アーキテクチャの表示 |
| `wts doctor --interactive` | 確認入力後に OS と CPU アーキテクチャを表示 |

対話には標準入力・標準出力の両方に TTY が必要です。否定回答と Ctrl-C によるキャンセルは終了コード `0`、TTY の不足と未知のコマンドは `1` です。`--check` と `--interactive` は併用できません。

## 端末での表示

端末ではコマンド名、操作対象、結果をまとめて表示します。成功・警告・エラーは色と記号で区別し、通信・命名・Worktree 作成・rebase・push の待ち時間には進捗を表示します。`--dry-run` は作成・削除・push の予定として表示し、操作の完了とは区別します。

確認は「はい／いいえ」で選択します。削除と push は「いいえ」が初期選択です。`start` の成功後には作成先へ移動する `cd` コマンド、`init` の成功後には設定検査のコマンドを表示します。

通常の結果は標準出力、警告・エラー・進捗は標準エラーに出力します。リダイレクトした出力には色やスピナーを含めません。`NO_COLOR=1` または `FORCE_COLOR=0` で色を無効にできます。CI と `TERM=dumb` では装飾と進捗アニメーションを抑制します。対話を必要とする操作は、非対話環境では引き続きオプションで入力してください。

## 作業の単位

| 用語 | 意味 |
| --- | --- |
| メインチェックアウト | `git clone` などで用意した元の作業ディレクトリ。そこでチェックアウト中のブランチ名とは無関係 |
| セッション | `wts start` が作る一つの worktree と、その中で扱うスタック |
| ルートブランチ（`root`） | セッション作成時の最初のブランチ。スタックの番号 1 に相当 |
| スタック | ルートブランチと `<root>-pr<n>-<名前>` 形式のブランチの列。番号順に扱う |
| スタック番号（`n`） | セッション内の順番。`--pr-number` で指定する 2 以上の整数で、GitHub の PR 番号とは別 |
| 管理範囲 | 設定の `worktreeDirectory` で指定するディレクトリ。セッションの配置と cleanup の対象判定に使用 |

ベースブランチの対話入力の既定値は `origin/main` です。これは Git の参照名であり、メインチェックアウトのパスを表しません。リポジトリのブランチに応じて `--base-branch origin/master` などを指定してください。cleanup の判定では `main` と `origin/main` を使用します。

## プロジェクトを初期化する

対象リポジトリのメインチェックアウトで実行します。

```bash
cd /path/to/project
wts init
wts config check
git add .wts.json
git commit -m "Configure wts sessions"
```

`init` は `.wts.json` を生成し、既存ファイルは上書きしません。既定の作成先はメインチェックアウトと同じ親ディレクトリの `<プロジェクト名>-worktrees`、命名は日本時間の日付＋UUID です。設定をセッションのベースブランチへコミットして共有してください。

`start`・`stack`・`restack`・`cleanup` は設定ファイルがないとエラーになります。作成先・命名スクリプト・プロンプトの設定方法と検査は [設定資料](docs/configuration.md)にまとめています。

## セッションで作業する

```bash
wts start --base-branch origin/main
```

表示された `Path` へ移動してください。wts は呼び出し元シェルのディレクトリを変更しません。

```bash
cd /path/printed/by/wts
# ファイルを編集して、作業をコミットする
wts stack --pr-number 2
# 次の作業を編集・コミットする
wts restack --base-branch origin/main --push
```

`stack` は同じ worktree 内で新しいブランチへ切り替えます。現在のブランチがスタックの先端で、未コミット変更がないことが必要です。番号省略時は、使用済みの最大番号＋1 を対話で提示します。

`restack` はスタックを rebase し、確認後に origin へ push します。`--push` は push の確認を省略します。PR の作成・マージは GitHub または gh で行ってください。

マージ後はメインチェックアウトなど、削除対象以外の場所から整理します。

```bash
cd /path/to/project
wts cleanup
```

`stack`・`restack` は `start` が作成したセッションで使用します。手作業で作成した worktree は対象になりません。cleanup の対象と削除条件は [マージ済みブランチの整理](#マージ済みブランチの整理)を確認してください。

## コマンドと入力

| コマンド | 主なオプション |
| --- | --- |
| `wts start` | `--task <内容>`、`--base-branch <ref>`、`--copy-from <directory>` |
| `wts stack` | `--task <内容>`、`--pr-number <n>` |
| `wts restack` | `--base-branch <ref>`、`--push`、`--push-only` |
| `wts cleanup` | `--yes`（削除確認を省略） |

4 コマンドは `--dry-run` に対応します。全オプションは `wts <コマンド> --help` で確認できます。

ベースとスタック番号は省略時に対話で入力します。命名スクリプトを設定した場合は作業内容も対話で入力します。非対話環境では必要な入力をオプションで渡してください。`--task ''` は空の作業内容を明示し、命名スクリプトがあれば空の内容でも実行します。

`BASE_BRANCH`、`COPY_FROM`、`PR_NUMBER`、`PUSH=1`、`PUSH_ONLY=1`、`DRY_RUN=1` を対応するオプションの代わりに使用できます。オプションを優先します。

### 実行予定の確認

4 コマンドとも `--dry-run` または `DRY_RUN=1` に対応します。fetch、Git ブランチ・worktree の変更、コピー、セッション情報・lease の書き込み、push は行いません。削除判定の GitHub 照会、restack のリモート参照取得、設定済み命名スクリプトの実行は行います。命名スクリプト自身の通信や副作用はその実装に依存します。

```bash
wts start --task '' --base-branch origin/main --dry-run
wts cleanup --dry-run
```

### 管理外ファイルのコピー

実行元 worktree の `.worktree-copy` に相対パス・glob を記載すると、新しい worktree へコピーします。空行と `#` 以降のコメントは無視します。

```text
.env.local
.claude/skills/*/skills/
```

コピー元は指定したローカルのベースブランチの worktree、存在しなければメインチェックアウトです。`--copy-from` で変更できます。存在しないパスはスキップし、コピー失敗は警告します。worktree 外や Git 管理情報へのコピー、シンボリックリンクのコピーは拒否します。

### マージ済みブランチの整理

`cleanup` は `main`、実行中のブランチ、設定された作成先の外にある worktree で使用中のブランチを除外します。同一リポジトリのマージ済み PR を確認し、その head と一致するか `origin/main` に到達可能なブランチを削除候補にします。それ以外はリモートブランチの不存在、push 済み tip、独自 merge commit の不存在、厳密なパッチ一致を確認します。削除を証明できない候補は理由と手動コマンドを表示します。

```bash
wts cleanup
```

削除対象の worktree は強制削除するため、未コミット・管理外ファイルも削除されます。ロックされた worktree は削除せず、失敗を報告します。

### rebase と push の再開

スタック操作はクリーンな作業ツリーを要求します。`restack` は非線形スタックと、別 worktree で使用中のスタックブランチを拒否します。rebase 開始時の origin の OID を `restack-lease` に保存し、コンフリクト時は停止します。解消後は次を実行します。

```bash
git rebase --continue
wts restack --push-only --base-branch origin/main --push
```

`--push-only` は保存した lease を使い、他者が push した変更の上書きを拒否します。リモート確認失敗や不足した lease はエラーになります。push の否定・Ctrl-C は正常終了し、lease を残します。通常終了時は元のブランチへ戻ります。

## 資料

- [設定項目・命名スクリプト・サンプル](docs/configuration.md)
- [開発環境・検証・ビルド・公開手順](docs/development.md)
- [責務と不変条件](docs/design.md)
- [設計判断の記録](docs/decisions.md)
- [作業規約](AGENTS.md)

## ライセンス

wts は [MIT License](LICENSE) で提供します。著作権者は 9uiLe です。依存ソフトウェアにはそれぞれのライセンスが適用されます。
