# wts

wts（Git Worktree Session）は、Git worktree と依存関係のあるブランチの列を管理する Apple Silicon macOS 向け CLI です。プロジェクト設定を共有し、作業場所の作成、ブランチの積み重ね、ベースの取り込み、一覧、整理・破棄を行います。

## 対応環境と配布状態

[GitHub Releases](https://github.com/9uiLe/wts/releases) で検証用 Pre-release を配布します。対象は Apple Silicon macOS で、Intel Mac・Linux・Windows は対象外です。最低対応 macOS は未確定で、GitHub Actions の macOS 15 ARM64 上で起動を検証します。

Developer ID 署名・公証は行っていません。Gatekeeper によって起動が制限される場合があり、許可手順と、配布経路を通した実機での導入・更新・実動作は未検証です。チェックサムの一致は起動制限を解消しません。各バージョンの検証範囲は Release の説明と `BUILD_INFO`、確認手順は [実機での配布経路の検証](docs/development.md#実機での配布経路の検証)を参照してください。

## インストール

配布バイナリは Bun ランタイムを含み、利用時に Nix・Bun・Node.js は不要です。Git を使用し、`restack` は Git 2.38 以上、`cleanup` は認証済み GitHub CLI（`gh`）を必要とします。fetch・PR 照会・push にはリモートへの接続が必要です。既定の命名は AI や外部の命名コマンドを使いません。

Apple Silicon Mac のターミナルで実行します。HTTPS で同じ Release のバイナリ・SHA-256・`BUILD_INFO` を取得し、チェックサムとバージョン・ターゲットを検証して `~/.local/bin/wts` に配置します。リポジトリの clone は不要です。

```bash
curl -fsSL https://9uile.github.io/wts/install.sh | bash
```

配置先が PATH にない場合は、インストーラーが表示する設定コマンドを実行してください。既定の配置先を zsh へ登録する場合は次のとおりです。シェル設定は自動変更しません。zsh 以外では使用するシェルの方法で登録します。

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
wts --version
wts doctor --check
```

Git・gh の導入や認証、Gatekeeper の許可は行いません。環境検査で不足を指摘された場合は、[Homebrew](https://brew.sh/) を用意して `brew install git gh`、認証には `gh auth login` を実行し、再検査してください。

### 更新と配置先の指定

実行中の wts を終了し、同じインストールコマンドを再実行します。取得・検証・配置に失敗した場合は既存のバイナリを保持します。配置先に既存の `wts` がある場合、通常ファイルかつ非シンボリックリンクである必要があります。

バージョンを固定する場合は先頭 `v` なしの SemVer、配置先を変える場合は `--install-dir` を指定します。次のバージョンは指定形式の例です。利用できるバージョンは [Releases](https://github.com/9uiLe/wts/releases) で確認してください。

```bash
curl -fsSL https://9uile.github.io/wts/install.sh | bash -s -- --version 0.2.0-rc.1 --install-dir "$HOME/.local/bin"
```

手動で取得したバイナリには [取得済み成果物からの導入](docs/development.md#取得済み成果物からの導入)、ソースから生成する場合は [開発環境](docs/development.md#開発環境)と [ビルド成果物](docs/development.md#ビルド成果物)の手順を使います。

## 環境の検査

```bash
wts doctor --check
```

対応 OS・CPU、Git 2.38 以上、gh の実行と認証を検査し、不足時の対処を表示します。必須項目を満たせば終了コード `0`、不足や検査失敗は `1` です。Claude CLI は命名スクリプトで使う場合の任意要件として検査し、未導入でも失敗しません。

リポジトリ外や非対話環境でも実行できます。[`gh auth status`](https://cli.github.com/manual/gh_auth_status) による認証確認には通信しますが、認証情報の表示、インストール、ログイン、設定変更は行いません。独自の命名スクリプトが使う環境は、そのスクリプトの手順で確認してください。

## 作業の単位

| 用語 | 意味 |
| --- | --- |
| メインチェックアウト | `git clone` などで用意した元の作業ディレクトリ。チェックアウト中のブランチ名とは無関係 |
| セッション | `wts start` が作る一つの worktree と、その中で扱うスタック |
| ルートブランチ（`root`） | セッション作成時の最初のブランチ。スタックの番号 1 に相当 |
| スタック | ルートと `<root>-pr<n>-<名前>` 形式のブランチの列。番号順に扱う |
| スタック番号（`n`） | `--pr-number` で指定する 2 以上の整数。GitHub の PR 番号とは別 |
| ベースブランチ | 作業の分岐元と更新の取り込み元。プロジェクト設定で指定する |
| 管理範囲 | `worktreeDirectory` で指定するセッション配置先。整理・破棄する worktree の対象判定にも使う |

## プロジェクトを初期化する

対象リポジトリのメインチェックアウトで、プロジェクトのベースブランチを指定します。`main` は実際のローカルブランチ名に置き換え、`origin/` は付けません。

```bash
cd /path/to/project
wts init --base-branch main
wts config check
git add .wts.json
git commit -m "Configure wts sessions"
```

`init` は `.wts.json` を実行元 worktree のルートに生成し、既存ファイルは内容が不正でも上書きしません。既定の作成先はメインチェックアウトと同じ親ディレクトリの `<プロジェクト名>-worktrees`、命名は日本時間の日付＋UUID です。ベースを省略すると保存せず、ローカルの `origin/HEAD` があれば候補だけを案内します。

設定と、利用する命名スクリプトをベースブランチへコミットして共有してください。`start`・`stack`・`restack`・`cleanup`・`discard`・`list` は設定が必要です。探索規則、設定項目、省略時の動作は [設定資料](docs/configuration.md)に記載しています。

## コマンドと入力

コマンドは `wts --help`、オプションは `wts <コマンド> --help` で確認できます。対話には標準入力・標準出力の両方に TTY が必要です。非対話では各操作に必要な入力をオプションで渡してください。成功と対話の否定・Ctrl-C は終了コード `0`、入力不足や未知のコマンドなどのエラーは `1` です。

`start`・`restack` は設定のベースを使い、操作時だけ変える場合は `--base-branch origin/release/stable` のように指定します。この上書きは `cleanup` の基準を変えません。設定も上書きもない場合の対話候補と優先順位は [ベースブランチ](docs/configuration.md#ベースブランチ)を参照してください。

`BASE_BRANCH`、`COPY_FROM`、`PR_NUMBER`、`PUSH=1`、`PUSH_ONLY=1`、`DRY_RUN=1` は対応するオプションの代わりに使えます。オプションを優先し、boolean 環境変数は値が `1` の場合だけ有効です。解除には unset を使います。

通常の結果は標準出力、警告・エラー・進捗は標準エラーです。JSON 出力はありません。リダイレクト時は色とスピナーを省き、`NO_COLOR=1` または `FORCE_COLOR=0` で色を無効にできます。CI と `TERM=dumb` では装飾と進捗アニメーションを抑制します。

### 実行予定の確認

`start`・`stack`・`restack`・`cleanup`・`discard` は `--dry-run` に対応します。fetch、ブランチ・worktree の変更、コピー、セッション情報・lease の書き込み、push は行いません。ただし、設定済み命名スクリプト、cleanup の GitHub・リモート照会、restack の通常モードでのリモート参照照会、discard の `--remote` 指定時のリモート照会は実行します。

```bash
wts start --task '' --dry-run
wts cleanup --dry-run
```

命名スクリプトの通信・副作用はその実装に依存し、名前は再実行で変わる場合があります。dry-run は候補を固定せず、本実行で再評価します。スクリプトを実行せずに設定を検査する場合は `wts config check` を使ってください。

## セッションで作業する

```bash
wts start
```

表示された `Path` へ移動します。wts は呼び出し元シェルのディレクトリを変更しません。ベースが `origin/` で始まる場合は fetch し、失敗して手元の参照を使う場合は警告します。

```bash
cd /path/printed/by/wts
# ファイルを編集してコミットする
wts stack --pr-number 2
# 次の作業を編集してコミットする
wts restack --push
```

`stack` は同じ worktree に新しいブランチを作って切り替えます。現在のブランチがスタック先端で、作業ツリーがクリーンである必要があります。番号は未使用の 2 以上を指定し、省略時は最大番号＋1 を対話で提示します。非対話では `--pr-number` が必要です。

命名スクリプトを設定した `start`、ブランチ命名スクリプトを設定した `stack` は作業内容を入力します。非対話では `--task '作業内容'` を渡します。`--task ''` は空の作業内容を渡す指定で、スクリプトは実行されます。名前の直接指定ではありません。

`restack` はスタックを rebase して origin へ push します。`--push` は push 確認を省略します。非対話の本実行には `--push` または `PUSH=1` が必要で、なければ push 対象がゼロでも fetch・lease 保存・rebase の前に終了します。PR の作成・マージは GitHub または gh で行ってください。

`stack`・`restack` は `start` が作ったセッションで使います。手作業の worktree は対象外です。start の作成後に失敗した場合は自動で元に戻さないため、表示された Path・ブランチと作成済み範囲を確認してから次の操作を決めてください。

### 管理外ファイルのコピー

実行元 worktree の `.worktree-copy` に、新しい worktree へ渡すファイルを書きます。

```text
.env.local
```

コピー元の指定、glob、境界外やシンボリックリンクの扱いは [コピー設定](docs/configuration.md#管理外ファイルのコピー)を参照してください。

### rebase と push の再開

`restack` はクリーンで線形なスタックを要求し、別 worktree で使用中のスタックブランチを拒否します。コンフリクト時は停止した rebase を解消し、必要な変更を stage して再開します。

```bash
git rebase --continue
wts restack --push-only --push
```

`--push-only` はベース入力・fetch・rebase を行わず、rebase 開始時に保存した lease で push を再開します。lease は他者のリモート更新を上書きしないための照合記録です。不足や不一致は原因を確認し、取り直しや強制 push で回避しないでください。成功時は記録を削除します。

対話で push を否定・Ctrl-C した場合は、rebase 後のローカル参照と lease を保持して正常終了し、origin は変更しません。rebase・push の失敗でも保存済み lease は残ります。rebase 進行中を除き元の checkout への復帰を試み、復帰失敗は警告します。

## セッションを一覧する

```bash
wts list
```

管理範囲内の登録済み worktree を通信なしで表示します。Path、ルート・スタック、現在のブランチ、dirty を確認できます。dirty は未コミット・未追跡・無視対象ファイルを含み、discard に `--force` が必要な状態です。手作業の worktree と壊れたセッション情報は「未管理」と表示します。

## マージ済みブランチの整理

`cleanup` は同じ GitHub リポジトリのマージ済み PR と変更の取り込みを確認し、ローカルブランチと対応する worktree を削除します。走査対象はローカルブランチ全体で、wts の命名に限定しません。設定のベース（省略時は `main`）、実行中のブランチ、管理範囲外の worktree で使用中のブランチは除外します。リモートブランチは削除しません。

削除対象以外の場所で候補を確認します。

```bash
wts cleanup --dry-run
```

**候補 worktree の未コミット・未追跡・無視対象ファイルも強制削除されます。** 出力された各パスで `git -C <path> status --short --untracked-files=all --ignored` などを使い、残したい内容を保存してから実行してください。候補の一部だけを選ぶオプションはありません。

```bash
wts cleanup
```

削除候補がある非対話本実行では `--yes` が必要です。本実行では確認前にベースを fetch して候補を再評価し、fetch 失敗時は古い参照で判定する旨を警告します。削除前の検査で変化を検出した対象や、削除できないロック中の worktree の参照は保持します。

部分失敗でも完了した削除は元に戻りません。完了件数、失敗段階、残存対象を確認してください。「参照削除済み・設定残存」はブランチ設定だけが残った状態です。「要確認」の手動コマンドは自動削除を証明できなかった候補なので、表示されたことだけを根拠に実行しないでください。

## セッションの破棄

`discard <path>` は指定した wts セッションの worktree と全所属ブランチを、マージ状況によらず削除します。メインチェックアウトなど対象の外から、worktree のルートパスを指定します。単一ブランチだけの削除には使いません。

| オプション | 削除範囲・条件 |
| --- | --- |
| 指定なし | worktree と所属ローカルブランチを削除。リモートを残し、通信しない |
| `--remote <名前>` | 登録済みリモートの push 先にある同名ブランチも削除 |
| `--force` | 未コミット・未追跡・無視対象ファイルの破棄を許可。これらがある場合に必要 |
| `--yes` | 確認入力を省略。非対話本実行に必要で、`--force` の代わりにはならない |

次は origin も削除する例です。ローカルだけなら `--remote origin` を省略します。

```bash
cd /path/to/project
wts discard ../project-worktrees/session-name --remote origin --dry-run
wts discard ../project-worktrees/session-name --remote origin
```

dry-run に表示された全ブランチとファイル状態を確認し、残したい内容を保存してください。本実行でも対象を再検査して確認を求め、既定の否定や Ctrl-C では何も削除しません。メイン・実行中・管理範囲外・未管理・ロック中の worktree、ベースブランチや別 worktree で使用中の所属ブランチを含むセッションは拒否します。

リモート削除には Git の push 認証とサーバーの atomic push 対応が必要です。push 先が複数のリモートは拒否します。upstream の別名ブランチは対象外で、同名ブランチが存在しなければスキップします。

リモートを指定した場合はその処理に成功してからローカルを削除します。途中で失敗しても完了済みの削除は戻らないため、エラーの完了段階と実際の残存対象を照合してください。通信障害ではリモートの結果が不明な場合があります。無条件の強制削除で失敗を回避しないでください。

## AI 向けスキル

`wts-cli` は AI による wts のセッション操作用スキルです。AI の実行環境の PATH に `wts` を配置し、スキルを導入します。

```bash
wts skills install wts-cli
```

既定の配置先は `~/.agents/skills/wts-cli/SKILL.md` です。`--path` にはスキルの親ディレクトリを指定します。[Claude Code の個人用スキル](https://code.claude.com/docs/en/skills#where-skills-live)として使う場合は次のとおりです。

```bash
wts skills install wts-cli --path "$HOME/.claude/skills"
```

AI にスキルを読み込ませ、`wts-cli` で操作するよう依頼してください。Claude Code では `/wts-cli` で呼び出せます。入口は `wts skills get wts-cli` で実行バイナリに対応するガイドを取得するため、バイナリ更新後も対応する手順を使えます。導入とガイド取得自体には Git・Bun・ソース・通信は不要です。

入口を更新するには導入コマンドを再実行します。同内容なら変更せず成功し、異なる内容は上書きを拒否します。既存の編集内容を確認し、置き換える場合だけ `--force` を指定してください。他のファイルは変更しません。

## 資料

- [設定・コピー・命名スクリプト](docs/configuration.md)
- [開発・検証・ビルド・公開](docs/development.md)
- [端末 UI カタログの生成とレビュー](docs/development.md#端末-ui-の一覧と変更確認)
- [設計・安全契約](docs/design.md)
- [作業規約](AGENTS.md)

## ライセンス

wts は [MIT License](LICENSE) で提供します。著作権者は 9uiLe です。依存ソフトウェアにはそれぞれのライセンスが適用されます。
