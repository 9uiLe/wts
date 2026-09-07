# wts

`wts`（Git Worktree Session）は、Apple Silicon macOS 向けのコマンドラインツールです。作業セッションの worktree 作成、スタックブランチ作成、マージ済みブランチの整理、スタックの rebase と push を提供します。

## 対応環境と配布

[GitHub Releases](https://github.com/9uiLe/wts/releases) で検証用の Pre-release を配布します。対象は Apple Silicon macOS です。最低対応 macOS は未確定で、GitHub Actions の macOS 15 ARM64 上で起動を検証します。Intel Mac、Linux、Windows は対象外です。

Developer ID 署名・公証は行っていません。ダウンロードしたバイナリは Gatekeeper によって起動が制限される場合があり、その許可手順は未検証です。チェックサムの一致は起動制限を解消しません。利用前に各 Release の説明と `BUILD_INFO` で検証範囲を確認してください。

セッション操作には Git、`cleanup` には認証済み GitHub CLI（`gh`）が必要です。`restack` には `rebase --update-refs` を使える Git 2.38 以降が必要です。作業内容からの名前生成は任意の `claude` CLI（haiku）を使用します。未導入・生成失敗時は日本時間の日時で命名します。fetch・PR 照会・push にはリモートへの接続が必要です。ヘルプ、バージョン、オプションなしの `doctor` にこれらの外部要件はありません。単体実行ファイルに Bun ランタイムを含むため、Nix、Bun、Node.js のインストールも不要です。

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

Git と gh も導入する場合は、[Homebrew](https://brew.sh/) を用意し、次のように実行します。

```bash
./scripts/install.sh --with-deps /path/to/downloads
gh auth login
"$HOME/.local/bin/wts" doctor --check
```

`--with-deps` は成果物の検証後に `brew install git gh` を実行し、成功した場合に wts を配置します。Homebrew の通常の install 動作に従って Git・gh とその依存を導入・更新します（[Git](https://formulae.brew.sh/formula/git)、[gh](https://formulae.brew.sh/formula/gh)、[Homebrew の仕様](https://docs.brew.sh/Manpage#install-options-formulacask-)）。Homebrew がない場合や導入に失敗した場合は wts の配置を中止します。Homebrew 自体と任意の claude は自動導入せず、認証は別途実行します。`--with-deps` を付けなければ依存の導入は行いません。

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
| 成果物のインストール・更新 | `./scripts/install.sh [--with-deps] [成果物ディレクトリ] [配置先ディレクトリ]` |

開発用スクリプトは固定された Nix 環境を使用します。`install.sh` は macOS の標準コマンドで実行します。どのスクリプトも、そのパスを指定すれば別のディレクトリから実行できます。引数と個別の検査方法は [開発コマンド](docs/development.md#開発コマンド)に記載しています。

## 使い方

```bash
wts --help
wts --version
wts doctor
wts doctor --check
wts doctor --interactive
```

| 引数 | 振る舞い |
| --- | --- |
| `--help` | コマンドとオプションを表示する |
| `--version` | wts のバージョンを表示する |
| `doctor` | バージョン、OS、CPU アーキテクチャを標準出力へ表示する |
| `doctor --check` | Apple Silicon macOS、Git 2.38 以上、gh の実行・認証、任意の claude の有無を検査する |
| `doctor --interactive` | 確認を求め、肯定された場合に OS と CPU アーキテクチャを表示する |

対話モードでは標準入力と標準出力の両方に TTY が必要です。否定回答と Ctrl-C によるキャンセルは終了コード `0` で終了します。TTY がない場合と未知のコマンドは標準エラーへエラーを表示し、終了コード `1` で終了します。

`doctor` は実行プロセスの環境を表示します。`doctor --check` は Git リポジトリ外や非対話環境でも実行でき、各項目の OK・NG と不足時の対処を標準出力に表示します。必須項目をすべて満たせば終了コード `0`、不足・実行失敗・認証確認失敗があれば `1` です。claude は任意なので、未導入でも失敗にはしません。

認証検査には [`gh auth status`](https://cli.github.com/manual/gh_auth_status) を使用するためネットワーク接続が必要です。認証情報そのものは表示しません。検査によるインストールやログイン、設定変更は行いません。`--check` と `--interactive` は同時に指定できません。Nix・Bun は開発用なので、配布 CLI の環境検査には含めません。

## セッション操作

対象の Git リポジトリ内で実行します。サブディレクトリからも利用できます。

```bash
wts start
wts stack
wts cleanup --dry-run
wts cleanup
wts restack
```

| コマンド | 処理・オプション |
| --- | --- |
| `start` | `<メインチェックアウト>-worktrees/YYYYMMDD-<slug>` に worktree を作成。`--task <内容>`、`--base-branch <ref>`、`--copy-from <directory>` |
| `stack` | セッション worktree の先端から `<root>-pr<n>-<slug>` を作成し切り替え。`--task <内容>`、`--pr-number <n>` |
| `cleanup` | 同一リポジトリのマージ済み PR を調べ、削除を証明できるブランチと worktree を確認後に削除。`--yes` で確認を省略 |
| `restack` | スタック先端を `rebase --update-refs` し、必要なブランチを `--atomic` と明示的な `--force-with-lease` で push。`--base-branch <ref>`、`--push`、`--push-only` |

全コマンドで `--dry-run` または `DRY_RUN=1` を指定できます。fetch、ブランチ・worktree の変更、コピー、lease の書き込み、push を行いません。削除判定の GitHub 照会や restack のリモート参照取得、作業内容の名前生成は行います。

`BASE_BRANCH`、`COPY_FROM`、`PR_NUMBER`、`PUSH=1`、`PUSH_ONLY=1` も対応するオプションの代わりに使用できます。オプションを優先します。ベースの既定は `origin/main`、スタック番号の既定は使用済み番号の最大値 + 1（最初は 2）です。番号は GitHub の PR 番号ではなくスタック内の順番です。

作業内容とベース・番号を省略すると対話で入力します。非対話実行では、必要な値を指定してください。名前生成を省略するには `--task ''` を指定します。セッションの日時名は `YYYYMMDD-HHMMSS`、スタックの代替 slug は `HHMMSS` です。同名ブランチを上書きしません。

```bash
wts start --task '' --base-branch origin/main --dry-run
wts stack --task '認証画面を追加' --pr-number 2
wts restack --base-branch origin/main --push
```

実行元 worktree の `.worktree-copy` があれば、記載した相対パス・glob を新しい worktree にコピーします。空行、`#` 以降のコメントは無視します。コピー元はベースブランチの worktree、存在しなければメインチェックアウトです。`--copy-from` で変更できます。存在しないパスはスキップし、コピー失敗は警告します。worktree の外や Git 管理情報へのコピー、シンボリックリンクのコピーは拒否します。

```text
.env.local
.claude/skills/*/skills/
```

整理対象から `main`、実行中のブランチ、セッション用ディレクトリ外の worktree で使用中のブランチを除外します。マージ済み PR の head と一致するか、`origin/main` に到達可能か、元スクリプトのリモート存在確認と厳密なパッチ比較で取り込みを証明できる場合に削除します。証明できない候補は理由と手動コマンドを表示します。対象 worktree は強制削除するため、未コミット・管理外ファイルも削除対象になります。ロックされた worktree は削除せず失敗を報告します。

スタック操作はクリーンな作業ツリーを要求します。restack は非線形スタックと、別 worktree で使用中のスタックブランチを拒否します。rebase 開始時の origin の OID を worktree 専用の Git ディレクトリに `restack-lease` として保存します。コンフリクト時はそこで停止するため、解消後に次を実行します。

```bash
git rebase --continue
wts restack --push-only --base-branch origin/main --push
```

`--push-only` は保存済み lease を再利用します。途中で他者が push した場合は上書きを拒否します。リモート確認失敗や不足した lease はエラーにします。push の否定・Ctrl-C は正常終了し、保存済み lease を残します。通常終了時は元のブランチへ戻ります。

## 開発資料

- [開発環境・検証・ビルド・公開手順](docs/development.md)
- [責務・バージョン・公開判定の設計](docs/design.md)
- [変更時の作業規約](AGENTS.md)

## ライセンス

wts は [MIT License](LICENSE) で提供します。著作権者は 9uiLe です。依存ソフトウェアには、それぞれのライセンスが適用されます。
