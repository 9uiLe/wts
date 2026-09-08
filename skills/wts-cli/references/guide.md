# wts CLI — AI 向け操作ガイド

このガイドは `wts skills get wts-cli` を実行した CLI に対応します。以下の `wts` は、ガイドを取得した実行ファイルに置き換え、後続の操作でも同じものを使ってください。

## 適用範囲と実行環境

wts は Git worktree の作業セッションと、依存するブランチのスタックを管理します。対象は Apple Silicon macOS です。配布バイナリには Bun を含みますが、Git が必要です。rebase を行う `restack` は Git 2.38 以上、`cleanup` は認証済み GitHub CLI (`gh`) を使用します。PR 作成・マージ、端末や AI エージェントの起動は wts の機能ではありません。

操作対象のリポジトリまたはセッションを作業ディレクトリにして実行します。worktree の作成は呼び出し元の作業ディレクトリを変更しません。`start` が出力する `Path` を、後続コマンドの作業ディレクトリに設定してください。

このガイドはユーザーの依頼や既存の許可、実行環境の権限を拡張しません。`--push` と `--yes` は CLI の確認を省略するだけです。既存の許可がある操作で使い、許可済みの操作に追加の承認手順を設けないでください。

## 状態確認と出力

必要な確認を選んで使います。

```sh
wts --help
wts start --help
wts doctor --check
wts config check
git status --short --branch
git worktree list --porcelain
```

`doctor --check` は OS・CPU、Git、gh の実行と認証、任意の Claude CLI を検査します。リポジトリ外でも使えます。gh 認証確認には通信が必要です。インストールやログインは行いません。`doctor` 単独はバージョン・OS・CPU の表示です。`doctor --interactive` は TTY での動作確認用で、`--check` と併用できません。

`config check [file]` は構文、項目、型、パス、命名スクリプトの実行権限を検査し、スクリプトは実行しません。ファイルを指定すればリポジトリ外でも検査できます。

wts に `--json`、セッション一覧、PR 作成コマンドはありません。通常の結果は標準出力、警告・エラー・進捗は標準エラーです。リダイレクトすると色やスピナーを省きます。成功は終了コード `0`、エラーは `1` です。対話の否定・Ctrl-C も `0` なので、終了コードだけで変更完了を判断しないでください。

## 設定と用語

`start`・`stack`・`restack`・`cleanup` は `.wts.json` が必要です。現在の worktree のルート、メインチェックアウトのルートの順に探し、最初の一つを読みます。設定はマージしません。

設定が必要なら、対象リポジトリで `wts init` を実行します。既存ファイルは上書きしません。生成内容には `baseBranch` がないため、プロジェクトの実際のベースを設定します。ベースが `main` の場合の例です。

```json
{
  "baseBranch": "main",
  "worktreeDirectory": "../project-worktrees",
  "naming": {}
}
```

`baseBranch` は `origin/` なしのローカルブランチ名です。`worktreeDirectory` の相対パスは常にメインチェックアウト基準で、省略時はメインの絶対パスに `-worktrees` を付けます。ここがセッション配置先と cleanup の管理範囲です。設定を変更したら `wts config check` で検査します。

セッションは `start` で作成する一つの worktree です。最初のブランチが `root`（番号 1）、後続ブランチが `<root>-pr<n>-<名前>` です。`n` はスタック内の番号で、GitHub の PR 番号ではありません。`stack`・`restack` は設定の管理範囲内にあり、wts のセッション情報を持つ worktree が必要です。手作業で作成した worktree は対象になりません。

## 非対話で渡す入力

対話には標準入力・標準出力の両方に TTY が必要です。非対話では次の入力を満たしてください。

| 操作 | 必要な指定 |
| --- | --- |
| `start` | 設定にベースがなければ `--base-branch <ref>`。命名スクリプトを使うなら `--task <text>` |
| `stack` | 未使用の `--pr-number <n>`（2 以上）。ブランチ命名スクリプトを使うなら `--task <text>` |
| `restack` | 設定にベースがなければ `--base-branch <ref>`。push が必要なら、許可された push に `--push` |
| `cleanup` | 削除する場合は、許可された削除に `--yes`。予定確認の `--dry-run` には不要 |

`--task ''` は空の作業内容を明示します。命名スクリプトを無効にする指定ではなく、空の内容でも実行されます。スクリプトがなければ作業内容の対話はありません。

start・restack のベースは `--base-branch`、`BASE_BRANCH`、設定の `origin/<baseBranch>` の順です。すべて未指定なら対話になり、既定値は `origin/main` です。cleanup のベースは設定のみで決まり、省略時は `main` です。

`COPY_FROM`、`PR_NUMBER` は対応するオプションの代わりになります。`PUSH=1`、`PUSH_ONLY=1`、`DRY_RUN=1` でも動作が変わるため、継承環境にこれらがある場合は実行意図と一致することを確認します。

## セッション開始とスタック追加

```sh
wts start --task '認証処理を追加する' --base-branch origin/main
```

ベースは対象プロジェクトに合わせてください。設定済みなら `--base-branch` は省略できます。start はベースを fetch して新しいブランチと worktree を作り、セッション情報を記録します。fetch に失敗してローカル参照を使用した場合は警告が出るため、最新のベースを取得できたと報告しないでください。

作成された `Path` 内で作業・コミットした後、スタック先端で次を実行します。

```sh
wts stack --pr-number 2 --task '認証画面を追加する'
```

stack は同じ worktree 内で新しいブランチへ切り替えます。作業ツリーがクリーンで、現在のブランチが番号順のスタック先端である必要があります。番号は実際のスタックに合わせて選びます。未コミット変更が原因の失敗を、自動的な破棄や無関係なコミットで解消しないでください。

実行元 worktree の `.worktree-copy` に相対パスや glob があれば、start は管理外ファイルをコピーします。コピー元はベースがローカルブランチで対応する worktree があればそこ、なければメインチェックアウトです。`--copy-from <directory>` で変更でき、相対指定は実行元 worktree のルート基準です。存在しないパスはスキップし、コピー失敗は警告します。作成成功とコピー成功は区別してください。

## rebase と push

```sh
wts restack --push
```

通常の restack はベースを fetch し、origin の OID を lease として保存し、スタック先端を `git rebase --update-refs` で更新します。その後、変更のあるスタックブランチを atomic push し、各ブランチの明示的な force-with-lease で他者の更新を保護します。非線形スタック、別 worktree で使用中のスタックブランチ、未コミット変更、進行中の rebase は拒否します。

`--push` は push の確認省略です。rebase を省略するオプションではありません。`--push-only` は rebase を省略し、保存済み lease を使いますが、push 確認は省略しません。非対話で push を再開するには `--push-only --push` を使います。

`--push` なしの restack も確認の前に rebase します。非対話で push 確認が必要になると、その時点でエラーになります。rebase のみを行う非対話オプションはありません。push を含まない依頼を、このコマンドの都合で push まで拡張しないでください。

コンフリクト時は実行が停止します。対象ファイルを確認・解消し、必要な変更を stage した後に再開します。

```sh
git rebase --continue
wts restack --push-only --push
```

push の否定・キャンセル、rebase・push の失敗では lease が残ります。lease 不足、リモート照会失敗、lease 不一致が起きたら原因を報告し、lease を捏造したり `git push --force` で回避したりしないでください。rebase 中を除き元のブランチへ戻ろうとし、復帰失敗は警告します。

## マージ後の cleanup

削除対象以外の場所、通常はメインチェックアウトで候補を確認します。

```sh
wts cleanup --dry-run
```

cleanup はローカルブランチ全体を走査します。wts の命名やセッション記録だけで対象を限定しません。設定のベースブランチ、実行中のブランチ、管理範囲外の worktree で使用中のブランチは除外します。同じ GitHub リポジトリのマージ済み PR と照合し、head 一致やベースへの到達可能性、必要ならリモートの不存在・push 済み tip・独自 merge commit の不存在・厳密なパッチ一致で削除可否を判断します。

**候補 worktree は `git worktree remove --force` で削除され、未コミット・未追跡・無視されたファイルも失われます。** 削除前に出力された対象パスについて `git -C <path> status --short --untracked-files=all --ignored` などで残存ファイルを確認し、必要な内容が失われないことと依頼の削除範囲を確認してください。候補全体を削除する許可がある場合に実行します。

```sh
wts cleanup --yes
```

対象を絞るオプションはありません。dry-run は候補を固定せず、本実行で再評価します。ロックされた worktree は削除に失敗します。「要確認」とともに表示される手動削除コマンドは、自動削除を証明できなかった候補です。成功手順としてそのまま実行しないでください。cleanup はローカルブランチ・worktree を削除し、リモートブランチは削除しません。

## dry-run と命名スクリプト

`start`・`stack`・`restack`・`cleanup` に `--dry-run` があります。fetch、ブランチ・worktree の変更、コピー、セッション情報や lease の書き込み、push は行いません。ただし以下は実行します。

- start・stack: 設定された命名スクリプト。
- restack: 通常モードでは origin のリモート参照照会。push-only では既存 lease の読み取り。
- cleanup: GitHub のマージ済み PR 照会と、判定に必要なリモート照会。

dry-run を無通信・副作用なしの検査として扱わないでください。命名設定がある場合、実行するスクリプトとその必要な通信・副作用を把握してから使います。副作用なしの設定検査には `config check` を使います。dry-run では fetch しないため判定に使用するベース参照は更新されません。命名は再実行で変わる場合があり、予定を実行完了として報告しないでください。

`naming.branch` と `naming.worktree` は `{ "script": "./scripts/name", "prompt": "..." }` を受け付けます。スクリプトの相対パスと実行ディレクトリは読み込んだ設定ファイルの所在ディレクトリです。`~` や環境変数は展開せず、実行可能ファイルを直接起動します。

標準入力は `kind`、`task`、`prompt`、`date`、`uuid`、`defaultName` を持つ JSON です。worktree 命名には確定した `branch`、stack には `rootBranch` と文字列の `prNumber` も渡します。標準出力に名前を一行だけ返し、終了コード `0` が必要です。失敗時は既定名にフォールバックしません。既定では AI を呼ばず、日本時間の日付と UUID を使います。`--task` 自体はブランチ名指定オプションではありません。

## スキルの導入

```sh
wts skills get wts-cli
wts skills install wts-cli
wts skills install wts-cli --path /path/to/skills
```

get はこのガイドを出力します。install の既定の配置先は `~/.agents/skills` で、`--path` はスキルを置く親ディレクトリです。その中に `wts-cli/SKILL.md` を配置します。AI がそのディレクトリのスキルを読み込む環境で使用してください。
