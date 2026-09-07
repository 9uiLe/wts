# wts

`wts`（Git Worktree Session）は、Apple Silicon macOS 向けの CLI です。`start` で作業用 worktree を作成し、`stack` でブランチを積み重ね、`restack` で rebase・push、`cleanup` でマージ済みブランチを整理します。

## 対応環境と配布

対象は Apple Silicon macOS です。[GitHub Releases](https://github.com/9uiLe/wts/releases) で検証用 Pre-release を配布します。最低対応 macOS は未確定で、GitHub Actions の macOS 15 ARM64 上で起動を検証します。Intel Mac、Linux、Windows は対象外です。

Developer ID 署名・公証は行っていません。ダウンロードしたバイナリは Gatekeeper によって起動が制限される場合があり、その許可手順は未検証です。チェックサムの一致は起動制限を解消しません。各 Release の説明と `BUILD_INFO` で検証範囲を確認してください。

セッション操作には Git、`restack` には Git 2.38 以上、`cleanup` には認証済み GitHub CLI（`gh`）が必要です。fetch・PR 照会・push にはリモートへの接続が必要です。既定の命名は日付＋UUID で、AI や命名用の外部コマンドを使用しません。命名スクリプトを設定する場合は、そのスクリプトが使う環境も用意してください。

配布バイナリは Bun ランタイムを含み、Nix、Bun、Node.js は不要です。ヘルプ、バージョン、オプションなしの `doctor` には外部コマンドの要件もありません。

## インストール

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

## プロジェクトの初期化と設定

対象の Git リポジトリのルートで設定ファイルを作成し、コミットします。

```bash
wts init
wts config check
git add .wts.json
git commit -m "Configure wts sessions"
```

`wts init` は実行中の worktree ルートに `.wts.json` を作成します。作成先には `../<メインチェックアウトのディレクトリ名>-worktrees`、命名には空の設定を記録します。既存の設定ファイルは上書きしません。設定をコミットしてベースブランチに含めることで、新しい worktree に設定を引き継げます。

`start`・`stack`・`cleanup`・`restack` とファイル指定なしの `config check` には `.wts.json` が必要です。実行中の worktree ルート、メインチェックアウトの順に探し、見つかった一つを読み込みます。両方にない場合はエラーになります。`init`、`doctor`、ヘルプ、バージョン表示は設定ファイルなしで利用できます。

命名項目を省略すると、ブランチ名は日本時間の `YYYYMMDD-<UUID>`、worktree 名はブランチ名と同じです。作成先や命名を編集した後は検査してください。

```bash
wts config check
wts config check /path/to/project/.wts.json
```

設定検査は JSON、項目、型、パス、実行権限を確認し、命名スクリプトを実行しません。設定が有効なら終了コード `0`、エラーなら `1` です。ファイルを明示すればリポジトリ外でも検査できます。

`worktreeDirectory` と `naming.branch`・`naming.worktree` による命名、JSON 標準入力の契約、Claude CLI を使う例は [設定資料](docs/configuration.md)を参照してください。スクリプトは設定した場合だけ実行し、失敗時は作成を中止します。

## セッションの作成とスタック

対象の Git リポジトリ内で実行します。サブディレクトリからも利用できます。

```bash
wts start
# 表示された Path のディレクトリへ移動して作業・コミットする
wts stack
wts restack
```

| コマンド | 処理・オプション |
| --- | --- |
| `start` | worktree とセッションのルートブランチを作成。`--task <内容>`、`--base-branch <ref>`、`--copy-from <directory>` |
| `stack` | 同じセッション worktree の先端から `<root>-pr<n>-<名前>` を作成して切り替え。`--task <内容>`、`--pr-number <n>` |
| `restack` | スタックを `rebase --update-refs` し、`--atomic` と明示的な `--force-with-lease` で push。`--base-branch <ref>`、`--push`、`--push-only` |
| `cleanup` | マージ済み PR とローカル変更を調べ、削除可能なブランチ・worktree を確認後に削除。`--yes` で確認を省略 |

ベース・番号を省略すると対話で入力します。命名スクリプトを設定した場合は、作業内容も省略時に対話で入力します。ベースの既定は `origin/main`、スタック番号の既定は使用済み番号の最大値＋1（最初は 2）です。番号はスタック内の順番を表します。命名スクリプトがなければ作業内容にかかわらず日付＋UUID を使用します。既存のブランチ・パスを上書きしません。

非対話環境では入力値を明示してください。`--task ''` は空の作業内容を渡します。設定済みの命名スクリプトは作業内容が空でも実行します。

```bash
wts start --task '' --base-branch origin/main
wts stack --task '' --pr-number 2
wts restack --base-branch origin/main --push
```

`BASE_BRANCH`、`COPY_FROM`、`PR_NUMBER`、`PUSH=1`、`PUSH_ONLY=1` を対応するオプションの代わりに使用できます。オプションを優先します。

`stack`・`restack` は `wts start` で作成したセッション内で実行します。worktree 名とブランチ名は独立して設定でき、セッションの識別情報は worktree 専用の Git ディレクトリに保存します。手作業で作成した worktree は wts のセッションとして扱いません。

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

## 開発資料

- [開発環境・検証・ビルド・公開手順](docs/development.md)
- [責務と不変条件](docs/design.md)
- [設計判断の記録](docs/work-log.md)
- [作業規約](AGENTS.md)

## ライセンス

wts は [MIT License](LICENSE) で提供します。著作権者は 9uiLe です。依存ソフトウェアにはそれぞれのライセンスが適用されます。
