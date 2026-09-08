# wts CLI 操作ガイド

wts は Git worktree の作業セッションと、依存するブランチのスタックを管理します。このガイドは `wts skills get wts-cli` を実行した CLI に対応します。以下の `wts` はガイドを取得した実行ファイルに置き換えてください。

## 共通事項

対象環境は Apple Silicon macOS です。配布バイナリには Bun が含まれ、Git は別途必要です。rebase を行う `restack` は Git 2.38 以上、`cleanup` は認証済み GitHub CLI (`gh`) を使用します。PR の作成・マージ、端末や AI エージェントの起動は提供しません。

操作対象のリポジトリまたはセッションを作業ディレクトリにして実行します。セッションは `start` が作る一つの worktree です。最初のブランチを root（番号 1）とし、後続ブランチは `<root>-pr<n>-<名前>` になります。`n` はスタック内の番号で、GitHub の PR 番号ではありません。`stack` と `restack` は、設定された配置先の内部にあり、wts のセッション情報を持つ worktree で実行します。

対話には標準入力・標準出力の両方に TTY が必要です。AI の非対話実行では各手順の入力をオプションで渡します。`--push` と `--yes` は確認を省略するため、依頼された操作の範囲で使います。

通常の結果は標準出力、警告・エラー・進捗は標準エラーです。リダイレクト時は色やスピナーを省きます。成功は終了コード `0`、エラーは `1` です。対話の否定・Ctrl-C も `0` なので、出力と併せて完了を判断してください。`--json` やセッション一覧コマンドはありません。

継承環境の `BASE_BRANCH`、`COPY_FROM`、`PR_NUMBER` は対応するオプションの入力になります。`PUSH=1`、`PUSH_ONLY=1`、`DRY_RUN=1` も動作を変えるため、実行意図と一致することを確認します。

## 目的別の読み方

| 目的 | 読む手順 |
| --- | --- |
| プロジェクトを設定する | 「プロジェクト設定」 |
| 作業用 worktree を作る | 「プロジェクト設定」「セッション開始」 |
| スタックへブランチを追加する | 「スタック追加」 |
| スタックのベースを更新して push する | 「rebase と push」 |
| 中断後の push を再開する | 「rebase と push」の再開手順 |
| マージ済みのローカル作業を削除する | 「マージ後の cleanup」 |
| 変更予定を確認する | 対象の手順と「dry-run」 |
| 命名スクリプトが設定されている、または命名を設定する | 「命名スクリプト」 |
| 起動環境・設定を検査する | 「診断」 |
| スキルを導入・更新する | 「スキルの導入」 |

## プロジェクト設定

`start`・`stack`・`restack`・`cleanup` は `.wts.json` を読みます。現在の worktree のルート、メインチェックアウトのルートの順に探し、最初の一つを使います。設定はマージしません。

設定がなければ対象リポジトリで `wts init` を実行します。既存ファイルは上書きしません。生成内容には `baseBranch` がないため、プロジェクトのベースを設定します。ベースが `main` の例です。

```json
{
  "baseBranch": "main",
  "worktreeDirectory": "../project-worktrees",
  "naming": {}
}
```

`baseBranch` は `origin/` なしのブランチ名です。`worktreeDirectory` の相対パスはメインチェックアウト基準です。省略時はメインの絶対パスに `-worktrees` を付けます。このディレクトリがセッション配置先と cleanup の worktree 管理範囲です。変更後は `wts config check` で検査します。

`start`・`restack` のベースは `--base-branch`、`BASE_BRANCH`、設定の `origin/<baseBranch>` の順に決まります。すべて未指定なら対話になるため、非対話では設定またはオプションが必要です。対話の既定値は `origin/main` です。cleanup は設定のベースを使い、省略時は `main` です。

## セッション開始

```sh
wts start --task '認証処理を追加する' --base-branch origin/main
```

ベースは対象プロジェクトに合わせます。設定済みなら `--base-branch` は省略できます。命名スクリプトがある場合、非対話では `--task` が必要です。実行前に「命名スクリプト」を読んでください。

start はベースが `origin/` で始まる場合に fetch し、新しいブランチと worktree を作ってセッション情報を記録します。fetch に失敗してローカル参照を使う場合は警告します。最新のベースを取得できたかは警告から判断してください。

作成後は出力の `Path` を後続コマンドの作業ディレクトリに設定します。start は呼び出し元の作業ディレクトリを変更しません。

実行元 worktree の `.worktree-copy` に相対パスや glob があれば、管理外ファイルをコピーします。コピー元は、ベースがローカルブランチで対応する worktree があればそこ、それ以外はメインチェックアウトです。`--copy-from <directory>` で変更でき、相対パスは実行元 worktree のルート基準です。存在しないパスはスキップし、コピー失敗は警告するため、worktree 作成とコピーの成否を分けて確認します。

## スタック追加

セッション内で作業をコミットし、番号順のスタック先端にいる状態で実行します。

```sh
wts stack --pr-number 2 --task '認証画面を追加する'
```

非対話では未使用の `--pr-number <n>`（2 以上）が必要です。例の番号を実際のスタックに合わせて変更します。ブランチ命名スクリプトがある場合は `--task` も渡し、「命名スクリプト」を読んでください。

stack は同じ worktree 内でブランチを作成して切り替えます。作業ツリーがクリーンで、現在のブランチがスタック先端である必要があります。

## rebase と push

スタックのセッションで実行します。作業ツリーがクリーンで、ブランチが番号順に祖先・子孫関係を持つ必要があります。別 worktree で使用中のスタックブランチや進行中の rebase がある場合は拒否します。

```sh
wts restack --push
```

通常モードはベースが `origin/` で始まる場合に fetch し、origin の OID を lease として保存してから、先端を `git rebase --update-refs` で更新します。その後、保存した OID と異なるスタックブランチを atomic push します。各ブランチの明示的な force-with-lease で他者の更新を保護します。ベースが設定されていなければ `--base-branch <ref>` も渡します。

`--push` は push 確認を省略します。`--push` なしでも確認の前に rebase し、非対話で push 確認が必要になるとエラーになります。rebase のみを行う非対話オプションはありません。push が依頼の範囲に含まれない場合は、この手順で push まで実行しないでください。

コンフリクト時は停止した rebase の対象を確認・解消し、必要な変更を stage して再開します。

```sh
git rebase --continue
wts restack --push-only --push
```

`--push-only` は rebase を省略し、保存済み lease を使います。ベースの解決と、`origin/` で始まるベースの fetch は行い、push 確認も残るため、非対話での再開には `--push-only --push` と必要に応じた `--base-branch` を指定します。

push の否定・キャンセル、rebase・push の失敗では lease が残ります。lease 不足、リモート照会失敗、lease 不一致は原因を報告し、lease の作成や `git push --force` で回避しないでください。rebase 中を除き元のブランチへの復帰を試み、復帰失敗は警告します。

## マージ後の cleanup

削除対象以外の場所、通常はメインチェックアウトで候補を確認します。

```sh
wts cleanup --dry-run
```

cleanup はローカルブランチ全体を走査します。wts の命名やセッション情報だけで対象を限定しません。設定のベースブランチ、実行中のブランチ、管理範囲外の worktree で使用中のブランチは除外します。同じ GitHub リポジトリのマージ済み PR と照合し、head 一致やベースへの到達可能性、必要ならリモートの不存在・push 済み tip・独自 merge commit の不存在・厳密なパッチ一致で削除可否を判断します。

**候補 worktree は `git worktree remove --force` で削除され、未コミット・未追跡・無視されたファイルも失われます。** 削除前に出力された対象パスについて `git -C <path> status --short --untracked-files=all --ignored` などで残存ファイルを確認し、必要な内容が失われないことと依頼の削除範囲を確認してください。候補全体が許可された削除対象であれば実行します。

```sh
wts cleanup --yes
```

対象を絞るオプションはありません。dry-run は候補を固定せず、本実行で再評価します。通常実行はベースを fetch し、失敗時は古い参照で判定する旨を警告します。ロックされた worktree は削除に失敗します。

「要確認」とともに表示する手動削除コマンドは、自動削除の条件を満たさなかった候補です。成功手順としてそのまま実行しないでください。cleanup が削除するのはローカルブランチと worktree です。リモートブランチは残ります。

## dry-run

`start`・`stack`・`restack`・`cleanup` に `--dry-run` があります。fetch、ブランチ・worktree の変更、コピー、セッション情報や lease の書き込み、push は行いません。ただし次の処理は実行します。

| コマンド | dry-run でも実行する処理 |
| --- | --- |
| start・stack | 設定された命名スクリプト |
| restack | 通常モードでは origin のリモート参照照会。push-only では既存 lease の読み取り |
| cleanup | GitHub のマージ済み PR 照会と、判定に必要なリモート照会 |

命名スクリプトの通信や副作用は「命名スクリプト」に従って確認します。スクリプトを実行せず設定だけを検査する場合は `config check` を使います。dry-run ではベース参照を更新せず、命名結果も再実行時に変わる場合があります。出力は実行予定として扱ってください。

## 命名スクリプト

`naming.branch` と `naming.worktree` は `{ "script": "./scripts/name", "prompt": "..." }` を受け付けます。設定がある場合は、実行するスクリプトと必要な通信・副作用を把握してから start・stack を使います。dry-run でもスクリプトは動作します。

スクリプトの相対パスと実行ディレクトリは、読み込んだ設定ファイルの所在ディレクトリです。`~` や環境変数は展開せず、実行可能ファイルを直接起動します。

標準入力は `kind`、`task`、`prompt`、`date`、`uuid`、`defaultName` を持つ JSON です。worktree 命名には確定した `branch`、stack の命名には `rootBranch` と文字列の `prNumber` も渡します。標準出力に名前を一行だけ返し、終了コード `0` が必要です。失敗時は既定名に切り替えず停止します。

スクリプトがなければ作業内容の対話はなく、日本時間の日付と UUID を使います。`--task` は命名スクリプトへ渡す作業内容で、ブランチ名の直接指定ではありません。`--task ''` は空の作業内容を渡し、設定済みのスクリプトは実行します。

## 診断

| 確認対象 | コマンド |
| --- | --- |
| コマンド・オプション | `wts --help`、`wts <command> --help` |
| バージョン・OS・CPU | `wts doctor` |
| 対応環境、Git、gh と認証、任意の Claude CLI | `wts doctor --check` |
| 設定の構文、項目、型、パス、命名スクリプトの実行権限 | `wts config check [file]` |
| 作業ツリーとブランチ | `git status --short --branch` |
| worktree の場所とブランチ | `git worktree list --porcelain` |

doctor はリポジトリ外でも使えます。`--check` の gh 認証確認は通信しますが、インストールやログインは行いません。`doctor --interactive` は TTY の動作確認用で、`--check` と併用できません。

`config check` は命名スクリプトを実行しません。ファイルを指定すればリポジトリ外でも検査できます。

## スキルの導入

```sh
wts skills install wts-cli
wts skills install wts-cli --path /path/to/skills
```

既定の親ディレクトリは `~/.agents/skills` です。`--path` は親ディレクトリを指定し、その中に `wts-cli/SKILL.md` を配置します。使用する AI が読み込むディレクトリを指定してください。

同内容の既存ファイルは変更せず成功します。異なる内容を置き換えるには `--force` を指定します。スキルの配置先ディレクトリや `SKILL.md` がシンボリックリンクの場合は拒否し、通常ファイルでない `SKILL.md` も置き換えません。

導入される SKILL.md は、実行ファイルを解決して `wts skills get wts-cli` を読み込む入口です。操作ガイドはバイナリに含まれ、get の実行時に出力されます。
