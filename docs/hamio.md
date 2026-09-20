# CLI 入出力と hamio の連携

wts は、利用者への表示・質問・進捗を [9uiLe/hamio](https://github.com/9uiLe/hamio) v0.1.0 / API v1 で処理する。hamio は JSON で呼び出す独立した実行ファイルであり、すべての wts コマンドで PATH に必要となる。本書は、入出力を実装・保守するための契約を定義する。利用者向けの指定方法は [README のコマンドと入力](../README.md#コマンドと入力)を参照する。

## 責務と実行環境

wts は引数・環境変数の解決、業務上の検証、Git 操作、設定・セッション情報・コピー対象の読み書きを担当する。hamio は表示と対話を担当し、操作の可否や実行順序は決定しない。

| モジュール | 責務 |
| --- | --- |
| [`src/cli.ts`](../src/cli.ts) | Commander による引数の解決、出力形式の設定、ヘルプ・バージョン・エラーの表示と wts の終了状態 |
| [`src/ui.ts`](../src/ui.ts) | メッセージ・項目一覧・結果の表示を受け付け、要求を順に送信 |
| [`src/display.ts`](../src/display.ts) | メッセージ・項目一覧を表示 block に変換し、API 上限に従って副作用なしで分割 |
| [`src/prompts.ts`](../src/prompts.ts) | 必要な端末条件の確認、既定値・省略・入力の選択、否定・キャンセルの扱い |
| [`src/hamio.ts`](../src/hamio.ts) | hamio の探索と互換性確認、要求の構築、応答の検証、フォームと進捗プロセスの管理 |
| [`src/process.ts`](../src/process.ts) | 引数配列による外部プロセスの起動と標準入出力の接続 |

配布する wts は Bun ランタイムを内包し、実行時の Nix・Bun・Node.js・ソースファイルを必要としない。hamio も独立した配布バイナリとして用意する。開発環境では Nix devShell が両者の固定された構成を提供する。導入方法は [README](../README.md#インストール)、開発時の手順は [開発環境](development.md#開発環境)に定義する。

## 出力形式と終了状態

全コマンドで `--format human|json` を受け付ける。省略時は stderr が TTY なら `human`、それ以外は `json` となる。パイプや AI からの利用では `--format json` を明示する。

| 形式 | stderr | stdout |
| --- | --- | --- |
| `human` | 人向けの結果・診断・進捗 | hamio の表示受付・進捗終了の JSON 応答 |
| `json` | 通常表示・進捗による出力なし | 表示内容と進捗の最終状態を含む JSON 応答 |

stdout は、表示要求の完了ごと、進捗処理の終了ごとに JSON を 1 行ずつ返す NDJSON である。一つの wts コマンドが複数行を返す場合があり、各行を独立して解析する。フォームの回答 JSON は wts が内部で処理し、stdout へ転送しない。

通常表示には `render` を使う。wts はメッセージを `message`、項目一覧を `key-value`、構造化した結果を `result` block として渡す。`message.level` は `info`・`success`・`warning`・`error` のいずれかとなる。例えば `wts --format json --version` は次の形で版を返す。

```json
{"apiVersion":1,"status":"ok","blocks":[{"kind":"result","success":true,"data":{"version":"0.1.0"}}]}
```

`human` の通常表示では、同じ要求に対する stdout の応答は `{"apiVersion":1,"status":"ok"}` となる。ヘルプは `message`、スキル取得は `result.data` の `name` と `lines` を使う。ガイド本文は `lines` を改行で結合して取得できる。

`ui.task` は `stream` を使い、渡された処理を一つの run と task で囲む。処理が正常に戻ったときの最終応答は次の形となる。

```json
{"apiVersion":1,"status":"ok","runId":"wts","result":{"success":true},"tasks":{"succeeded":1,"failed":0},"warnings":[]}
```

`status: "ok"` は hamio が表示要求を処理できたことを表す。進捗の `result.success` は、処理からの正常な戻りを `true`、例外を `false` として表す。例外時も表示の終了処理に成功すれば `status` は `ok` で、`tasks.failed` は `1` となる。

Git の非ゼロ終了コードなどを戻り値として受け取った場合は、進捗終了後に呼び出し元がその値を検査する。進捗の `result.success` が `true` でも、wts の業務処理は失敗する場合がある。コマンドの成功は wts の終了コードと診断で判断する。

wts の成功と対話の否定・キャンセルは終了コード `0`、入力不足・未知のコマンド・業務処理や表示の失敗は `1` とする。キャンセルはその時点から先の操作を中止するものであり、完了済みの Git 操作を取り消さない。操作ごとの状態と復旧方法は [設計資料](design.md)に定義する。

## 質問とキャンセル

対話を行うには、次の条件をすべて満たす必要がある。

- stdin と stderr が TTY である。
- `TERM` が `dumb` ではない。
- `CI` が未設定または空である。
- `--format json` を明示していない。

対話できない環境で必要な入力が不足した場合は、オプションなどでの指定を求めるエラーを返す。`--format human` の指定だけでは対話条件を満たさない。

確認質問には `confirm` を使い、初期選択は否定とする。テキスト入力では、最初に `select` で「既定値を使う」または「スキップ」と「入力する」を選ぶ。入力を選んだ場合だけ、空文字を許可しない必須の `text` を開く。これは、hamio の `default` が対話欄の初期値ではなく確定した回答として扱われ、未提供の任意項目は質問されないという [フォーム契約](https://github.com/9uiLe/hamio/blob/v0.1.0/src/core/form.ts)に従う。

フォーム定義は一時ディレクトリ内のファイルに権限 `0600` で保存する。次の定義では、回答の `id` が `wts`、`values.value` が boolean であることを確認する。`text` は string、`select` は提示した選択肢に含まれる string を要求する。

```json
{"apiVersion":1,"id":"wts","fields":[{"id":"value","kind":"confirm","label":"続行しますか？"}]}
```

```json
{"apiVersion":1,"status":"ok","id":"wts","values":{"value":false}}
```

`form --definition FILE --interactive auto` には定義ファイルのパスを渡し、stdin と stderr を端末から継承する。`--definition -` は hamio が受け付けないため使わない。回答用 stdout は捕捉し、成功・失敗・キャンセルのいずれでも一時ディレクトリを除去する。

hamio の `status: "cancelled"` と終了コード `130` を wts のキャンセルへ変換し、部分回答を使わない。否定・キャンセルでは中止を表示して正常終了する。[hamio のフォーム API](https://github.com/9uiLe/hamio/blob/v0.1.0/docs/api.md#フォーム)

## プロセスと進捗の管理

各 wts プロセスは、最初の hamio 利用時に PATH を探索し、`hamio capabilities` の終了コード、JSON、`apiVersion: 1`、`version: "0.1.0"` を検証する。実行ファイルのパスはそのプロセス内で再利用する。コマンドの業務処理を始める前にこの確認を行い、ヘルプとバージョン表示でも同じ境界を通す。

| 呼び出し | stdin | stderr | stdout |
| --- | --- | --- | --- |
| `capabilities` | 閉じる | 捕捉 | 互換性確認に使用 |
| `render` | 表示要求の JSON | 継承 | 応答を検証して wts の stdout へ転送 |
| `form` | 継承 | 継承 | 回答を検証して呼び出し元へ返す |
| `stream` | 進捗イベントの NDJSON | 継承 | 最終応答を検証して wts の stdout へ転送 |

表示・進捗の `--format` は wts で明示された値を渡し、省略時の判定は hamio に委ねる。質問の呼び出しは `--format json` の場合に `--interactive never`、それ以外に `auto` を指定する。外部 JSON は境界で型と構造を検証し、実行ファイルと引数は配列で渡す。

進捗は `run.start`、`task.start`、業務操作、`task.finish`、`run.finish` の順に進む。すべてのイベントに `apiVersion: 1`、同じ `runId: "wts"`、0 から連続する `seq` を付ける。wts が使用する task ID は `operation` である。

```jsonl
{"apiVersion":1,"runId":"wts","seq":0,"type":"run.start","title":"リポジトリの更新"}
{"apiVersion":1,"runId":"wts","seq":1,"type":"task.start","taskId":"operation","label":"リポジトリの更新"}
{"apiVersion":1,"runId":"wts","seq":2,"type":"task.finish","taskId":"operation","status":"succeeded"}
{"apiVersion":1,"runId":"wts","seq":3,"type":"run.finish","result":{"success":true}}
```

`ui.task` に渡した処理が例外で終了した場合は task を `failed`、run の結果を `success: false` として終了する。失敗の表示にも障害が起きた場合は、呼び出し元へ元の例外を返す。stdin を閉じ、最終応答と子プロセスの終了を待ってから結果表示や質問へ進む。例外時に残った子プロセスも終了させる。

時間のかかる外部操作は非同期で実行し、待機中も端末の描画を処理できるようにする。同じ端末で進捗と質問を同時に描画しない。`run.finish` より前の EOF は hamio のエラーとなる。[連続表示の契約](https://github.com/9uiLe/hamio/blob/v0.1.0/docs/api.md#連続表示)

hamio の欠落・非互換・起動失敗・不正な応答で表示を利用できない場合は、wts が直接 stdout に `apiVersion: 1`、`status: "error"`、`error.code: "HAMIO_UNAVAILABLE"` と説明を含む JSON を返す。これが hamio を経由しない利用者向け出力である。

## 表示制約

色と端末制御は hamio の自動判定に従う。色の判定には stderr の TTY、`TERM`、`NO_COLOR` を使い、`FORCE_COLOR` は使わない。色を無効にしても、対話フォームのカーソル制御は行う。human 形式では制御文字を無害化し、行を端末幅に収めるため、機械処理で全文を取得する場合は JSON 形式を使う。[端末条件](https://github.com/9uiLe/hamio/blob/v0.1.0/docs/api.md#対話形式色)、[文字処理](https://github.com/9uiLe/hamio/blob/v0.1.0/src/terminal/text.ts)

次の値は [hamio API v1 の資源上限](https://github.com/9uiLe/hamio/blob/v0.1.0/src/core/contract.ts)であり、wts の業務データの上限を定めるものではない。

| 対象 | 上限と wts の扱い |
| --- | --- |
| 文字列 | UTF-8 4,096 bytes。メッセージは改行で分け、長い行は Unicode の文字を壊さず分割 |
| 一度の表示 | 32 blocks。メッセージと項目一覧を上限内の render 要求にまとめる |
| `key-value` | 1 block に 200 項目。項目の順序を維持して block に分割し、ラベルや値は変更しない |
| 単発 JSON | 256 KiB。JSON エスケープ後の UTF-8 bytes と要求の構造を含めて数え、メッセージ・項目一覧を複数の要求に分割 |
| フォーム | 64 項目、選択肢 100 件。wts は一つの質問を一つのフォームで扱う |

メッセージと項目一覧の分割は [`src/display.ts`](../src/display.ts) が副作用なしで行い、[`src/ui.ts`](../src/ui.ts) が各要求を順に送信する。表示呼び出しは全要求の処理が終わるまで戻らず、後続の質問や進捗へ出力を持ち越さない。NDJSON の行数は内容と上限に応じて変わるため、項目単位の行数には依存せず、各応答の blocks を順に読み取る。単独のラベル・値・結果など、分割できない内容の上限違反は hamio の入力検証エラーとして扱う。

## バージョン固定と外部依存

| 項目 | 固定対象 |
| --- | --- |
| 製品 | [v0.1.0](https://github.com/9uiLe/hamio/releases/tag/v0.1.0)、API v1 |
| 製品ソース | `1c266341fd4d62c9314f6654abda00cd223941fa` |
| Nix パッケージ定義 | [`dd8c86c6923f692ef183152958147bf095e85daa`](https://github.com/9uiLe/hamio/tree/dd8c86c6923f692ef183152958147bf095e85daa) |
| 対象 | `aarch64-darwin` / 公開資産 `darwin-arm64` |
| 展開後バイナリ SHA-256 | `dd45f29f67ba6687a186a9004c616159f675d1409fe690edd7d6ceae284c4c82` |
| 公開 SBOM SHA-256 | `e8bfe95da32a03b74be808d048fc4365283660d64aaa22b38d21f7e9bc5f643c` |

[`flake.nix`](../flake.nix) は hamio input を上表のコミットに固定し、`hamio.packages.aarch64-darwin.hamio` を devShell に含める。hamio の nixpkgs は提供元の `flake.lock` を保持し、wts の nixpkgs へ `follows` させない。これにより [提供元が定める構成](https://github.com/9uiLe/hamio/blob/dd8c86c6923f692ef183152958147bf095e85daa/docs/distribution.md#nix-で導入する)を使う。

Nix パッケージは v0.1.0 の gzip・checksum・SBOM・notices を個別の SHA-256 で取得し、展開後のバイナリも照合する。製品ソースと Nix 定義はそれぞれの固定対象を参照する。[固定情報](https://github.com/9uiLe/hamio/blob/dd8c86c6923f692ef183152958147bf095e85daa/nix/release.json)、[取得・照合処理](https://github.com/9uiLe/hamio/blob/dd8c86c6923f692ef183152958147bf095e85daa/nix/package.nix)

hamio 本体は [MIT License](https://github.com/9uiLe/hamio/blob/v0.1.0/LICENSE) であり、配布物は Bun 1.4.2 と次の JavaScript 部品を含む。これらは hamio バイナリ内の依存で、wts の `bun.lock` には含まれない。

| 部品 | 版 | 依存先 |
| --- | --- | --- |
| `@clack/core` | 1.5.1 | `fast-wrap-ansi`、`sisteransi` |
| `fast-wrap-ansi` | 0.2.2 | `fast-string-width` |
| `fast-string-width` | 3.0.2 | `fast-string-truncated-width` |
| `fast-string-truncated-width` | 3.0.3 | なし |
| `sisteransi` | 1.0.5 | なし |

上記五部品の SPDX 許諾は MIT。正確な構成と許諾は [公開 SBOM](https://github.com/9uiLe/hamio/releases/download/v0.1.0/hamio-v0.1.0-darwin-arm64.spdx.json) と [固定された依存グラフ](https://github.com/9uiLe/hamio/blob/v0.1.0/bun.lock)を参照する。Bun は JavaScriptCore・native ライブラリ・polyfill を含む集約部品で、SBOM の許諾は `NOASSERTION` となる。Nix メタデータは MIT と LGPL-2.1-only を記載する。Bun 内部は部品単位で網羅されていないため、[公開 notices](https://github.com/9uiLe/hamio/releases/download/v0.1.0/hamio-v0.1.0-darwin-arm64.notices.txt) と [Bun・native 部品の許諾元](https://github.com/9uiLe/hamio/blob/dd8c86c6923f692ef183152958147bf095e85daa/docs/research/runtime-review.md)も扱う。

hamio の通常起動はローカルのファイルと標準入出力を使い、外部プロセス起動・ネットワーク取得・自動更新を行わない。ビルドでは `.env`・`bunfig.toml`・`package.json`・`tsconfig.json` の自動読み込みと依存の自動取得を無効にする。導入時の Nix/GitHub への通信は [Nix の取得処理](https://github.com/9uiLe/hamio/blob/dd8c86c6923f692ef183152958147bf095e85daa/nix/package.nix)が担う。[プロセス境界](https://github.com/9uiLe/hamio/blob/v0.1.0/src/cli.ts)、[ビルド設定](https://github.com/9uiLe/hamio/blob/v0.1.0/scripts/build/compiler.ts)

## 検証の責務

入出力の変更では、[UI テスト](../tests/ui.test.ts)で stdout・stderr・応答形式・失敗・API 上限を、[端末テスト](../tests/terminal.test.ts)で TTY の肯定・否定・Ctrl-C・文字入力・JSON 時の非対話を確認する。各コマンドのテストは一時 Git リポジトリと bare origin を使い、入出力に対応する業務状態を確認する。実行方法と表示カタログの運用は [開発資料](development.md#検証を実行する)に定義する。

依存の追加・更新は [依存の検証](development.md#依存の検証)に従う。wts の `bun.lock` に対する監査に加え、hamio の公開 SBOM を別途照会する。hamio 本体と同梱 Bun は SBOM に照会用の PURL・CPE がないため、SBOM による脆弱性照会の対象外となる。SBOM と notices、提供元の [runtime 検証資料](https://github.com/9uiLe/hamio/blob/dd8c86c6923f692ef183152958147bf095e85daa/docs/research/runtime-review.md)を使い、確認できた部品と範囲外を区別する。

公開物の出所は `gh release verify`、`gh release verify-asset`、`gh attestation verify` で確認する。attestation の照合対象にはリポジトリ、release workflow、製品タグ `refs/tags/v0.1.0`、製品ソースコミット、GitHub-hosted runner を含める。監査・動作検証の結果は対象コミットを特定できる PR・CI・Release に記録し、[ビルド成果物](development.md#ビルド成果物)と [正式リリースの条件](development.md#正式リリースの条件)を満たす証拠として扱う。
