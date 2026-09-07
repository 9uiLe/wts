# プロジェクト設定

この資料は `.wts.json` の設定項目、パスの解釈、命名スクリプトとの入出力を定義します。セッション・ルートブランチ・スタック番号の意味と通常の作業手順は [README](../README.md#作業の単位)を参照してください。

wts は Git リポジトリの `.wts.json` を読み取ります。実行中の worktree のルートを優先し、ファイルがなければメインチェックアウトのルートを探します。両方になければ設定を必要とするコマンドはエラーになります。設定はマージせず、見つかった一つのファイルを使います。

## 初期化と既定の動作

対象の Git リポジトリで初期化します。サブディレクトリから実行しても、その worktree のルートに `.wts.json` を生成します。

```bash
wts init
wts config check
git add .wts.json
git commit -m "Configure worktree sessions"
```

メインチェックアウトの名前が `project` の場合、次の設定を生成します。

```json
{
  "worktreeDirectory": "../project-worktrees",
  "naming": {}
}
```

既存の `.wts.json` は内容が不正であっても上書きしません。設定ファイルをセッションのベースブランチへコミットすると、新しい worktree にも引き継がれます。命名スクリプトを追加した場合は、そのファイルもコミットしてください。

`start`・`stack`・`cleanup`・`restack` とファイル指定なしの `config check` は設定ファイルが必要です。`init`・`doctor`・ヘルプ・バージョン表示は設定を必要としません。

設定項目を省略した場合、作成先はメインチェックアウトの絶対パスに `-worktrees` を付けたパス、セッションのブランチ名は日本時間の `YYYYMMDD-<UUID>` です。UUID は作成ごとに生成します。worktree のディレクトリ名はブランチ名と同じです。AI や外部の命名コマンドは呼び出しません。既存のブランチ・パスと衝突した場合は上書きせずエラーにします。

スタックブランチは `<root>-pr<n>-<YYYYMMDD-UUID>` になります。`root` はセッション作成時のブランチ、`n` は GitHub の PR 番号とは独立したスタック内の番号です。命名スクリプトを設定しても `<root>-pr<n>-` の部分はスタック管理に使用するため固定です。

## 設定項目

```json
{
  "worktreeDirectory": "../project-worktrees",
  "naming": {
    "branch": {
      "script": "./scripts/name-branch.py",
      "prompt": "作業内容からブランチ用の名前を返してください。"
    },
    "worktree": {
      "script": "./scripts/name-worktree.py",
      "prompt": "作業内容からディレクトリ用の名前を返してください。"
    }
  }
}
```

| 項目 | 型 | 省略時・内容 |
| --- | --- | --- |
| `worktreeDirectory` | 空でない文字列 | メインチェックアウトの絶対パスに `-worktrees` を付けたパス。絶対パスまたはメインチェックアウトを基準とする相対パス |
| `naming` | オブジェクト | スクリプトを使わず日付＋UUID で命名 |
| `naming.branch` | オブジェクト | 日付＋UUID。設定すると start のブランチ名と stack の接尾辞をスクリプトで生成 |
| `naming.worktree` | オブジェクト | start のブランチ名の `/` を `-` に置換。stack は既存 worktree を使用するため、この設定を使わない |
| `naming.*.script` | 空でない文字列、必須 | 実行可能なスクリプトファイルへのパス。相対パスは読み込んだ `.wts.json` の所在ディレクトリが基準 |
| `naming.*.prompt` | 文字列 | 空文字。スクリプトへ渡す任意のプロンプト |

不明な項目、型違い、`null`、存在しない・実行できないスクリプトはエラーです。`naming.branch` や `naming.worktree` を指定するときは `script` が必要です。`~`・環境変数・シェル式の展開はしません。スクリプトには shebang と実行権限を設定します。

作成先は存在しなくても指定できます。既存の親パスがディレクトリであり書き込み可能であることを検査します。メインチェックアウトそのものや Git の管理領域は作成先にできません。リポジトリ内に置く場合は、そのディレクトリを `.gitignore` に追加してください。cleanup はこの作成先を管理範囲として使うため、worktree 専用のディレクトリを指定します。

相対の作成先は worktree 内から実行しても常にメインチェックアウト基準です。名前の異なる worktree でも stack・restack を使えるよう、start は worktree 専用の Git ディレクトリに `wts-session.json` を保存します。stack・restack はこの記録を必要とし、手動で作成した worktree は対象にしません。作成先を後から変更した場合、変更前の場所は現在の管理範囲から外れます。

## 設定の検査

対象の Git リポジトリ内で実行します。

```bash
wts config check
```

ファイルを明示するとリポジトリ外でも検査できます。この場合、相対の作成先は指定ファイルのディレクトリを基準に検査します。

```bash
wts config check /path/to/project/.wts.json
```

ソースから使うためのスクリプトもあります。固定された Nix devShell の Bun で同じ検査を実行し、呼び出したディレクトリと引数を維持します。

```bash
/path/to/wts/scripts/check-config.sh
/path/to/wts/scripts/check-config.sh /path/to/project/.wts.json
```

成功は終了コード `0`、エラーは `1` です。JSON 構文、既知の項目、型、パス、実行権限を検査します。スクリプトのロジックや AI の応答、スクリプトが内部で使うコマンドまでは検査しません。実行環境と gh 認証の検査には `wts doctor --check` を使用します。

## 命名スクリプトの入出力

スクリプトは設定ファイルの所在ディレクトリで実行します。コマンドライン引数にプロンプトを連結せず、次の JSON を標準入力で一度渡します。

| 項目 | 内容 |
| --- | --- |
| `kind` | `branch` または `worktree` |
| `task` | `--task` または対話で入力した作業内容 |
| `prompt` | その命名設定の `prompt`。未指定は空文字 |
| `date` | 日本時間の `YYYYMMDD` |
| `uuid` | 命名時に生成した UUID |
| `defaultName` | スクリプトを使わない場合の名前 |
| `branch` | worktree 命名時に確定済みのブランチ名 |
| `rootBranch` | セッションのルートブランチ名（stack の場合） |
| `prNumber` | stack の番号（文字列、stack の場合） |

適用しない項目は省略します。作業内容が空でも、設定したスクリプトは実行します。スクリプトを設定していない場合、作業内容の対話入力は行いません。

標準出力には名前を一行だけ出力し、終了コード `0` を返してください。start の branch 出力は最終的な Git ブランチ名、stack の branch 出力は固定の `<root>-pr<n>-` に続く名前です。worktree 出力には単一のディレクトリ名を返します。絶対パス、`/`、`\`、`.`、`..`、`.git` は使用できません。

ブランチ名は Git の規則で検証します。非ゼロ終了、空出力、複数行、不正な名前は作成前のエラーにします。設定したスクリプトの失敗を既定名へ置き換えることはありません。標準エラーの内容は wts のエラー表示へ転載しません。

`--dry-run` でも実際の予定名を得るために命名スクリプトは実行します。設定検査では実行しません。AI の利用、通信、出力の決め方は渡したスクリプトで実装します。

## Claude で作業内容から命名する例

`claude -p --model haiku` で作業内容に合う名前を生成する場合は、[サンプルスクリプト](examples/name-with-claude.py)を対象プロジェクトの `scripts/name-with-claude.py` へコピーして実行権限を付けます。この例だけは Python 3 と認証済み Claude CLI を必要とします。wts の既定の命名にはどちらも不要です。

```bash
chmod +x scripts/name-with-claude.py
```

`.wts.json` に次を設定します。

```json
{
  "naming": {
    "branch": {
      "script": "./scripts/name-with-claude.py",
      "prompt": "以下のタスク説明から、git ブランチ名に適した英語のスラッグを生成してください。\nルール:\n- 英小文字とハイフンのみ使用\n- 50文字以内\n- スラッグのみを出力（説明や装飾は不要）\n- 情報が不足していても質問や確認をせず、与えられた文字列だけから推測して出力する\n- 例: add-notification-banner, fix-login-crash, refactor-auth-module"
    }
  }
}
```

50 文字はこのサンプルのプロンプトとスクリプトで定める条件です。wts 自体にこの長さの制限はありません。例は start では `YYYYMMDD-<slug>`、stack では `<root>-pr<n>-<slug>` を作ります。worktree は branch と同じ名前になります。worktree の名前を別途生成する場合は `naming.worktree` にも `script` と用途に合う `prompt` を設定します。
