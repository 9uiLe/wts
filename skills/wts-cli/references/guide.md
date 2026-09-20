# wts CLI 操作ガイド

このガイドは `wts --format json skills get wts-cli` を実行したバイナリの操作契約です。以下の `wts` は同じ実行ファイルに置き換え、対象リポジトリまたはセッションを作業ディレクトリにして操作します。

## 実行環境と入力

対象は Apple Silicon macOS です。配布バイナリは Bun を含み、すべてのコマンドで PATH 上の hamio v0.1.0 が必要です。Git は別途必要です。restack の rebase には Git 2.38 以上、cleanup には認証済み GitHub CLI（`gh`）を使います。PR 作成・マージ、端末・AI エージェントの起動は wts の操作範囲外です。

AI からはすべてのコマンドに `--format json` を指定し、必要な入力をオプションで渡します。この指定では TTY でも入力を待たず、必要な値がなければエラーになります。人向けの対話は stdin・stderr 両方の TTY が必要で、CI と `TERM=dumb` では行いません。「確認」は出力・設定と依頼範囲の照合を意味し、許可された対象と影響が明確なら追加の質問は不要です。push、削除対象、残存ファイルの破棄の許可が不明なら、その範囲をユーザーに確認してから実行してください。確認省略のオプション自体は許可を与えません。

`BASE_BRANCH`・`COPY_FROM`・`PR_NUMBER` は同名のオプションに対応し、`PUSH=1`・`PUSH_ONLY=1`・`DRY_RUN=1` は対応するフラグを有効にします。オプションを優先し、boolean 環境変数は `1` のときだけ有効、解除は unset です。継承した値が依頼と一致することを確認してください。

`--format json` の stdout は hamio の API v1 応答を 1 行ずつ返す NDJSON です。通常の表示は `blocks`、進捗処理の最終応答は `runId`・`result`・`tasks`・`warnings` を持ちます。全体を一つの JSON として扱わず、行ごとに処理してください。ガイドは `blocks` 内の `kind: "result"` ブロックの `data.lines` を改行で連結して取得できます。バージョンは同じ種類のブロックの `data.version` です。

人向けの `--format human` は stderr に表示し、stdout には JSON 応答を返します。成功と対話の否定・Ctrl-C は終了コード `0`、エラーは `1` です。hamio の `status: "ok"` は UI 処理の成功なので、操作の完了は wts の終了コードと表示データ、必要に応じて参照・ファイルの状態で判断します。

## 操作の選択

メインチェックアウトは clone した元の作業場所です。セッションは start が作る一つの worktree と、そのルート・スタックブランチの列です。ルートは番号 1、後続は `<root>-pr<n>-<名前>` で、番号は GitHub の PR 番号とは独立しています。

| 目的 | コマンド | 実行場所 | 読む節 |
| --- | --- | --- | --- |
| 初期化・設定検査 | `init`・`config check` | 対象リポジトリ | [プロジェクト設定](#プロジェクト設定)、[診断](#診断) |
| 作業場所と状態の一覧 | `list` | 対象リポジトリ | [セッション一覧](#セッション一覧) |
| 作業場所の作成 | `start` | 通常はメインチェックアウト | [セッション開始](#セッション開始) |
| ブランチ追加 | `stack` | 対象セッション | [スタック追加](#スタック追加) |
| ベース更新・push・再開 | `restack` | 対象セッション | [rebase と push](#rebase-と-push) |
| マージ済み作業の整理 | `cleanup` | 削除対象外 | [マージ後の cleanup](#マージ後の-cleanup) |
| セッション全体の破棄 | `discard <path>` | 削除対象外 | [セッションの破棄](#セッションの破棄) |
| 環境・コマンドの診断 | `doctor`・`--help` | リポジトリ外でも可 | [診断](#診断) |
| AI へのスキル導入 | `skills install wts-cli` | リポジトリ外でも可 | [スキルの導入](#スキルの導入) |

共通の入力条件と対応する操作節を読みます。設定を解決する場合は [プロジェクト設定](#プロジェクト設定)、命名を設定した start・stack では [命名スクリプト](#命名スクリプト)、予定を調べる場合は [dry-run](#dry-run) も読みます。

## プロジェクト設定

`start`・`stack`・`restack`・`cleanup`・`discard`・`list` は `.wts.json` を必要とします。現在の worktree のルート、メインチェックアウトのルートの順に探し、最初の一つを使います。設定はマージしません。

`wts --format json init --base-branch main` で実行元 worktree のルートに設定を生成します。ベース名は対象プロジェクトに合わせ、既存設定は上書きしません。`wts --format json init` だけではベースを保存せず、ローカルの `origin/HEAD` があれば候補だけを案内します。設定を `wts --format json config check` で検査し、使う命名スクリプトとともにベースブランチへコミットして共有します。

`baseBranch` は `origin/` なしのローカルブランチ名です。start・restack は `--base-branch`、`BASE_BRANCH`、設定の `origin/<baseBranch>` の順に優先します。`--format json` では設定または上書きが必要です。人向けの対話は候補を使うか別の参照を入力するか選び、候補はローカルの `origin/HEAD`、なければ `origin/main` です。cleanup は設定のベースだけを使い、省略時は `main` を保護して `origin/main` への取り込みを判定します。

`worktreeDirectory` は配置先と cleanup・discard の管理範囲です。相対パスは常にメインチェックアウト基準で、省略時はメインの絶対パスに `-worktrees` を付けます。変更すると旧配置は管理範囲から外れます。メイン自体や Git 管理領域は指定できず、リポジトリ内に置く場合は `.gitignore` に追加してください。

## セッション一覧

```sh
wts --format json list
```

管理範囲内の登録済み worktree を通信なしで表示します。Path、ルート・スタック、現在のブランチ、dirty を確認できます。dirty は未コミット・未追跡・無視対象ファイルを含み、discard に `--force` が必要な状態です。手動の worktree と壊れたセッション情報は「未管理」と表示し、discard の対象にはしません。

## dry-run

`start`・`stack`・`restack`・`cleanup`・`discard` の `--dry-run` は、fetch、ブランチ・worktree の変更、コピー、セッション情報・lease の書き込み、push を行いません。ただし次は実行します。

| コマンド | dry-run でも実行する処理 |
| --- | --- |
| start・stack | 名前の解決に使う命名スクリプト（start で名前を明示した側は省略） |
| restack | 通常モードは origin のリモート参照照会。push-only は保存済み lease の読み取り |
| cleanup | GitHub のマージ済み PR 照会と、判定に必要なリモート照会 |
| discard | セッション・ブランチ・ファイル状態の検査。`--remote` 指定時は push 先のリモート参照照会 |

命名スクリプトの通信・副作用を把握してから実行してください。スクリプトを動かさず設定だけを検査するには `config check` を使います。dry-run はベース参照を更新せず候補を固定しません。命名結果も再実行時に変わる場合があります。

## セッション開始

```sh
wts --format json start --task '認証処理を追加する' --base-branch origin/main
```

ベースは対象プロジェクトに合わせ、設定済みならオプションを省略できます。実行する命名スクリプトがある場合は、非対話では `--task` が必要です。ベースが `origin/` で始まれば fetch し、失敗して手元の参照を使う場合は警告します。作成後は出力の `Path` を後続コマンドの作業ディレクトリにしてください。呼び出し元のディレクトリは変わりません。

名前が決まっている場合は `start --branch feature/auth --worktree auth` で指定できます。明示した側の命名スクリプトは dry-run でも実行せず、未指定の側は既存の命名設定に従います。worktree 命名設定もなければブランチ名の `/` を `-` に置換します。実行するスクリプトがなければ `--task` は不要です。設定自体の検査は行い、ブランチ・パスの衝突は上書きせず拒否します。`--worktree` は管理範囲内の単一ディレクトリ名です。並列作業には別々の名前を使い、それぞれの出力 `Path` で後続操作を行います。

管理外ファイルは実行元 worktree の `.worktree-copy` に相対パス・glob を一行ずつ指定します。空行と `#` 以降は無視します。コピー元はローカル名で指定したベースの worktree、なければメインチェックアウトです。`--copy-from` で変更でき、相対パスは実行元 worktree のルートが基準です。

リストがなければコピーせず、存在するリストを読めなければ作成前に停止します。コピー元にないパスはスキップします。symlink・特殊ファイル・`.git`・境界外は、dry-run で拒否予定を表示し、本実行では警告付きでスキップします。

作成後の失敗は自動で元に戻りません。表示された Path・ブランチと、worktree・ブランチ・セッション記録の作成済み範囲を確認し、start を無条件に再実行しないでください。

## スタック追加

セッション内の作業をコミットし、クリーンな作業ツリーとスタック先端のブランチで実行します。同じ worktree に新しいブランチを作って切り替えます。

```sh
wts --format json stack --pr-number 2 --task '認証画面を追加する'
```

非対話では未使用の `--pr-number <n>`（2 以上）が必要です。ブランチ命名スクリプトがある場合は `--task` も渡します。例の番号・作業内容は実際のスタックに合わせてください。

## rebase と push

start が作ったセッション内で実行します。作業ツリーがクリーンで、スタックが番号順の祖先・子孫関係を持つ必要があります。別 worktree で使用中のスタックブランチや進行中の rebase がある場合は拒否します。

```sh
wts --format json restack --push
```

ベースが未設定なら `--base-branch <ref>` も渡します。通常モードはベースが `origin/` で始まる場合に fetch し、rebase 後に origin へ push します。他者の更新を上書きしないよう、rebase 前のリモート状態を lease として保存して照合します。

非対話本実行には `--push` または `PUSH=1` が必要で、未指定なら push 対象がゼロでも fetch・lease 保存・rebase 前に拒否します。rebase だけを行う非対話モードはありません。push が依頼範囲に含まれる場合に実行してください。

### 中断後の再開

コンフリクトを解消して必要な変更を stage し、次を実行します。

```sh
git rebase --continue
wts --format json restack --push-only --push
```

`--push-only` はベース入力・fetch・rebase・lease の再取得を行わず、保存済み lease で push します。成功時は lease を除去します。不足、リモート照会失敗、不一致は原因を報告し、lease の作成・取り直しや `git push --force` で回避しないでください。

対話で push を否定・Ctrl-C すると、rebase 後のローカル参照と lease を保持して正常終了し、origin は変わりません。rebase・push の失敗でも保存済み lease は残ります。rebase 中を除き元の checkout への復帰を試み、復帰失敗は警告します。

## マージ後の cleanup

削除対象以外の場所、通常はメインチェックアウトで候補を確認します。

```sh
wts --format json cleanup --dry-run
```

cleanup はローカルブランチ全体を走査し、同じ GitHub リポジトリのマージ済み PR と変更の取り込みを確認します。wts の命名やセッション情報には限定しません。設定のベース、実行中ブランチ、管理範囲外の worktree で使用中のブランチは除外します。削除するのはローカルブランチと対応する worktree で、リモートブランチは残ります。

**候補 worktree の未コミット・未追跡・無視対象ファイルも強制削除されます。** 対象ごとに `git -C <path> status --short --untracked-files=all --ignored` などで残存ファイルを照合し、必要な内容が失われないことを確認します。候補を絞るオプションはないため、全候補と残存ファイルの破棄が許可されている場合に実行してください。

```sh
wts --format json cleanup --yes
```

削除候補がある非対話本実行では `--yes` が必要です。dry-run は候補を固定せず、本実行では確認前にベースを fetch して再評価します。fetch 失敗時は古い参照で判定する旨を警告します。削除前の検査で変化を検出した対象や、削除できないロック中の worktree の参照は保持します。

部分失敗でも完了した削除は戻りません。完了件数・失敗段階・残存対象を確認してください。「参照削除済み・設定残存」はブランチ設定だけが残った状態です。「要確認」の手動コマンドは自動削除の条件を満たさなかった候補なので、そのまま成功手順として実行しないでください。

## セッションの破棄

`discard <path>` は一つの wts セッションの worktree と全所属ブランチを、マージ状況によらず削除します。単一ブランチの削除には使いません。メインチェックアウトなど対象の外から、worktree のルートパスを指定します。

| オプション | 対象・必要な許可 |
| --- | --- |
| `--remote` なし | worktree と所属ローカルブランチを削除。通信せずリモートを残す |
| `--remote <名前>` | 登録済みリモートの push 先にある同名ブランチも削除範囲に含む場合 |
| `--force` | 未コミット・未追跡・無視対象ファイルまで破棄する場合。これらがあるときに必要 |
| `--yes` | 確認入力を省略。非対話本実行に必要で、`--force` の代わりにはならない |

次は origin も依頼された削除範囲に含む場合の例です。パスとリモート名を実際の対象に置き換え、ローカルだけなら `--remote origin` を省略します。

```sh
cd /path/to/project
wts --format json discard /path/to/session --remote origin --dry-run
```

表示された worktree・全対象ブランチ・ファイル状態を依頼範囲と照合して実行します。dry-run は対象を固定せず、本実行で再検査します。

```sh
wts --format json discard /path/to/session --remote origin --yes
```

対話の既定値は否定で、否定・Ctrl-C は何も削除しません。対象は設定された管理範囲内のセッションです。メイン・実行中・管理範囲外・未管理・ロック中の worktree、ベースブランチや別 worktree で使用中の所属ブランチを含むセッションは拒否します。

リモート削除には Git の push 認証とサーバーの atomic push 対応が必要です。push 先が複数のリモートは拒否します。upstream の別名は対象外で、同名ブランチが存在しなければスキップします。

リモートを指定した場合はその処理に成功してからローカルを削除します。失敗時は停止しますが、完了した削除は元に戻りません。エラーの完了段階と残存対象を照合し、通信障害ではリモートの結果も確認してください。エラー回避のため無条件の Git 強制削除へ切り替えないでください。

## 命名スクリプト

`naming.branch` と `naming.worktree` は `{ "script": "./scripts/name", "prompt": "..." }` を受け付けます。実行するスクリプトと通信・副作用を把握してから使ってください。相対パスと実行ディレクトリは読み込んだ設定ファイルの所在ディレクトリです。`~` や環境変数は展開せず、実行可能ファイルを直接起動します。

標準入力は `kind`、`task`、`prompt`、`date`、`uuid`、`defaultName` を持つ JSON です。worktree 命名には確定した `branch`、stack 命名には `rootBranch` と文字列の `prNumber` も渡します。標準出力に名前を一行だけ返し、終了コード `0` が必要です。失敗時は既定名に切り替えず停止します。

未設定なら作業内容の対話はなく、日本時間の日付＋UUID で命名します。`--task` はスクリプトへ渡す作業内容で、名前の直接指定ではありません。`--task ''` でも名前の解決に使うスクリプトは実行します。

## 診断

| 確認対象 | コマンド |
| --- | --- |
| コマンド・オプション | `wts --format json --help`、`wts --format json <command> --help` |
| バージョン・OS・CPU | `wts --format json doctor` |
| 対応環境、Git、gh と認証、任意の Claude CLI | `wts --format json doctor --check` |
| 設定の構文・項目・型・パス・スクリプト実行権限 | `wts --format json config check [file]` |
| 作業ツリーとブランチ | `git status --short --branch` |
| worktree の場所とブランチ | `git worktree list --porcelain` |

doctor はリポジトリ外でも使えます。`--check` は gh 認証確認で通信しますが、インストール・ログインは行いません。`--interactive` は人向けの TTY の動作確認用で、`--check` と併用できません。AI 操作の `--format json` では入力を待ちません。

`config check` は解決された設定を表示し、命名スクリプトは実行しません。ファイルを明示すればリポジトリ外でも検査できます。

## スキルの導入

```sh
wts --format json skills install wts-cli
wts --format json skills install wts-cli --path /path/to/skills
```

既定の親ディレクトリは `~/.agents/skills` です。`--path` は使用する AI の読み込み先の親ディレクトリを指定し、その中に `wts-cli/SKILL.md` を配置します。

同内容なら変更せず成功します。異なる既存内容の置き換えが依頼範囲に含まれる場合だけ `--force` を使います。配置先ディレクトリや `SKILL.md` が symlink の場合、通常ファイルでない `SKILL.md` の場合は拒否します。他のファイルは変更しません。

導入する SKILL.md は実行バイナリから `wts --format json skills get wts-cli` で操作ガイドを取得する入口です。ガイドはバイナリに含まれ、取得には PATH 上の hamio が必要ですが、別の参照ファイルやネットワークは不要です。
