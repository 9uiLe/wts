# CLI 入出力と hamio の連携

wts の入出力は、業務処理を担う wts と、表示・質問・進捗を担う [9uiLe/hamio](https://github.com/9uiLe/hamio) のプロセス間で受け渡す。hamio は JSON API を持つ独立した実行ファイルであり、すべての wts コマンドで PATH 上の v0.1.0 / API v1 を必要とする。

本書は、入出力の責務、プロトコル、資源管理、依存と検証の契約を定義する。利用者向けの指定方法は [README のコマンドと入力](../README.md#コマンドと入力)、Git 操作と永続状態は [設計資料](design.md)に定義する。

## 責務と実行環境

wts は引数・環境変数の解決、業務上の検証、Git 操作、設定・セッション情報・コピー対象の読み書きを担当する。hamio は要求された内容を表示し、端末から回答を取得する。操作の可否と実行順序は wts が決定する。

| モジュール | 責務 |
| --- | --- |
| [`src/cli.ts`](../src/cli.ts) | Commander による引数の解決、出力形式の設定、ヘルプ・バージョン・エラーの表示、wts の終了状態 |
| [`src/ui.ts`](../src/ui.ts) | メッセージ・項目一覧・結果の表示を受け付け、要求を順に送信 |
| [`src/display.ts`](../src/display.ts) | メッセージ・項目一覧を表示 block に変換し、API 上限内の要求を副作用なしで構築 |
| [`src/prompts.ts`](../src/prompts.ts) | 対話条件の確認、既定値・省略・入力の選択、否定・キャンセルの扱い |
| [`src/hamio.ts`](../src/hamio.ts) | hamio の探索と版・API の照合、JSON の送受信と応答検証、フォームと進捗プロセスの管理 |
| [`src/process.ts`](../src/process.ts) | 引数配列による外部プロセスの起動と標準入出力の接続 |

通常表示は `ui`、要求の計算は `display`、hamio との通信は `hamio`、プロセスの起動は `process` に責務を置く。質問では `prompts` が入力の意味を扱い、`hamio` がフォームの要求と回答を扱う。外部 JSON は `unknown` として受け取り、利用する型と構造を通信境界で検証する。実行ファイルと引数は配列で渡す。

配布する wts は Bun ランタイムを内包し、実行時の Nix・Bun・Node.js・ソースファイルを必要としない。hamio も独立した配布バイナリとして用意する。Nix devShell は両者の固定された構成を提供する。導入方法は [README](../README.md#インストール)、開発時の手順は [開発環境](development.md#開発環境)を参照する。

## 出力形式と終了状態

全コマンドで `--format human|json` を受け付ける。明示された値は hamio に渡し、省略時の判定は hamio が行う。stderr が TTY なら `human`、それ以外は `json` となる。パイプや AI からの利用では `--format json` を明示する。

| 形式 | stderr | stdout |
| --- | --- | --- |
| `human` | 人向けの結果・診断・進捗 | 表示受付・進捗終了の JSON 応答 |
| `json` | 通常表示・進捗による出力なし | 表示内容と進捗の最終状態を含む JSON 応答 |

stdout は、表示要求の完了ごと、進捗処理の終了ごとに JSON を 1 行ずつ返す NDJSON である。一つの wts コマンドが返す行数は、表示内容と API 上限によって決まる。機械利用側は各行を独立して解析し、応答の種類に応じて表示内容や処理結果を読む。フォームの回答 JSON は wts 内部で扱い、stdout へ転送しない。

json 形式の通常表示は、`blocks` 配列に表示データを返す。項目一覧の block は `items` 配列を持ち、機械利用側は両方の配列の全要素を順に読む。`wts --format json --version` は次の形で版を返す。

```json
{"apiVersion":1,"status":"ok","blocks":[{"kind":"result","success":true,"data":{"version":"0.1.0"}}]}
```

`human` の通常表示では、同じ要求の stdout 応答は `{"apiVersion":1,"status":"ok"}` となる。ヘルプは `message` block、スキル取得は `result.data` の `name` と `lines` を使う。ガイド本文は `lines` を改行で結合して取得できる。

`ui.task` に渡した処理が正常に戻ったときは、進捗の最終応答を次の形で返す。

```json
{"apiVersion":1,"status":"ok","runId":"wts","result":{"success":true},"tasks":{"succeeded":1,"failed":0},"warnings":[]}
```

`status: "ok"` は hamio が要求を処理できたことを表す。進捗の `result.success` は、渡された処理からの正常な戻りを `true`、例外を `false` として表す。例外時も進捗の終了処理に成功すれば `status` は `ok`、`tasks.failed` は `1` となる。Git の非ゼロ終了コードなどを戻り値として受け取る処理では、呼び出し元が進捗終了後に値を検査するため、`result.success: true` だけでは業務の成功を判定できない。

コマンドの成功は wts の終了コードと診断で判断する。成功と対話の否定・キャンセルは終了コード `0`、入力不足・未知のコマンド・業務処理や表示の失敗は `1` とする。キャンセルはその時点から先の操作を中止し、完了済みの Git 操作は取り消さない。

hamio が見つからない、要求する版・API と一致しない、起動できない、応答が不正であるなど、表示を利用できない場合は wts が直接 stdout に次の情報を含む JSON を返し、終了コードを `1` にする。これが hamio を経由しない利用者向け出力である。

```json
{"apiVersion":1,"status":"error","error":{"code":"HAMIO_UNAVAILABLE","message":"失敗の説明"}}
```

## 表示制約

通常表示では、`ui` が受け付けた内容を `render` の JSON 要求にする。

| 内容 | block | データ |
| --- | --- | --- |
| メッセージ | `message` | `text` と、`info`・`success`・`warning`・`error` のいずれかの `level` |
| 項目一覧 | `key-value` | ラベルと値を持つ `items` |
| 構造化した結果 | `result` | `success: true` と JSON 値の `data` |

`display` はメッセージを改行で区切り、長い行を Unicode のコードポイントの途中で切らずに分割する。項目一覧ではラベルと値を一つの項目として扱い、その内容と順序を保って block を構築する。block は、項目数・block 数・要求全体のバイト数を数えながら順に生成する。全文からすべての要求を一度に配列化することはない。

次の値は [hamio API v1 の資源上限](https://github.com/9uiLe/hamio/blob/v0.1.0/src/core/contract.ts)であり、wts の業務データ自体の上限ではない。

| 対象 | 上限と wts の扱い |
| --- | --- |
| 文字列 | UTF-8 4,096 bytes。メッセージは上限内の文字列に分割する |
| 一度の表示 | 32 blocks。メッセージ・項目一覧の block を上限内の要求にまとめる |
| `key-value` | 1 block に 200 項目。項目のラベルと値はそのまま渡す |
| 単発 JSON | 256 KiB。JSON エスケープ後の UTF-8 bytes に、要求の構造と区切り文字を含めて数える |
| フォーム | 64 項目、選択肢 100 件。wts は一つの質問を一つのフォームで扱う |

`ui` は生成された要求を順に同期送信し、すべての応答を受け取ってから戻る。出力を後続の質問や進捗へ持ち越さない。単独のラベル・値・結果など、分割できない内容の上限違反は hamio の入力検証エラーとして扱う。

色と端末制御は hamio の自動判定に従う。色の判定には stderr の TTY、`TERM`、`NO_COLOR` を使い、`FORCE_COLOR` は使わない。色を無効にしても、対話フォームのカーソル制御は行う。`human` 形式では制御文字を無害化し、行を端末幅に収める。機械処理で全文を取得する場合は `json` 形式を使う。[端末条件](https://github.com/9uiLe/hamio/blob/v0.1.0/docs/api.md#対話形式色)、[文字処理](https://github.com/9uiLe/hamio/blob/v0.1.0/src/terminal/text.ts)

## 質問とキャンセル

対話を行うには、次の条件をすべて満たす必要がある。

- stdin と stderr が TTY である。
- `TERM` が `dumb` ではない。
- `CI` が未設定または空である。
- `--format json` を明示していない。

対話できない環境で必要な入力が不足した場合は、オプションなどでの指定を求めるエラーを返す。`--format human` の指定だけでは対話条件を満たさない。フォームの起動引数は `--format json` の場合に `--interactive never`、それ以外に `--interactive auto` とする。

確認質問には `confirm` を使い、初期選択は否定とする。テキスト入力では、まず `select` で「既定値を使う」または「スキップ」と「入力する」を選ぶ。入力を選んだ場合だけ、空文字を許可しない必須の `text` を開く。hamio の `default` は確定した回答を表し、未提供の任意項目は質問されないため、入力欄の初期値や省略の選択には使わない。[フォーム契約](https://github.com/9uiLe/hamio/blob/v0.1.0/src/core/form.ts)

フォーム定義は一時ディレクトリ内のファイルに権限 `0600` で保存し、`form --definition FILE` に渡す。stdin と stderr は端末から継承し、回答用 stdout は捕捉する。`--definition -` は hamio が受け付けないため使わない。一時ディレクトリは成功・失敗・キャンセルのいずれでも除去する。

各フォームの ID は `wts`、質問の ID は `value` とする。確認質問の要求と回答は次の形をとる。

```json
{"apiVersion":1,"id":"wts","fields":[{"id":"value","kind":"confirm","label":"続行しますか？"}]}
```

```json
{"apiVersion":1,"status":"ok","id":"wts","values":{"value":false}}
```

wts は回答の `id` が `wts` であることを確認し、`values.value` を質問の型に照らして検証する。`confirm` は boolean、`text` は string、`select` は提示した選択肢に含まれる string を要求する。

hamio の `status: "cancelled"` と終了コード `130` は wts のキャンセルとして扱い、部分回答を使わない。否定・キャンセルでは中止を表示して正常終了する。[hamio のフォーム API](https://github.com/9uiLe/hamio/blob/v0.1.0/docs/api.md#フォーム)

## プロセスと進捗の管理

各 wts プロセスは、最初の hamio 利用時に PATH を探索し、`hamio capabilities` の終了コード `0`、JSON オブジェクト、`apiVersion: 1`、`version: "0.1.0"` を確認する。実行ファイルのパスはそのプロセス内で再利用する。コマンドの業務処理はこの確認後に始め、ヘルプとバージョン表示も同じ境界を通す。

| 呼び出し | stdin | stderr | stdout |
| --- | --- | --- | --- |
| `capabilities` | 閉じる | 捕捉 | 版と API の照合に使用 |
| `render` | 表示要求の JSON | 継承 | 応答を検証して wts の stdout へ転送 |
| `form` | 継承 | 継承 | 回答を検証して呼び出し元へ返す |
| `stream` | 進捗イベントの NDJSON | 継承 | 最終応答を検証して wts の stdout へ転送 |

通常の応答では JSON オブジェクト、`apiVersion: 1`、`status: "ok"`、終了コード `0` を要求する。フォームのキャンセルは前節の条件で扱う。応答が条件を満たさなければ `HamioError` とし、wts のエラー処理へ渡す。

`ui.task` は一つの業務操作を一つの run と task で囲む。進捗は `run.start`、`task.start`、業務操作、`task.finish`、`run.finish` の順に進む。イベントには `apiVersion: 1`、同じ `runId: "wts"`、0 から連続する `seq` を付け、task ID は `operation` とする。

```jsonl
{"apiVersion":1,"runId":"wts","seq":0,"type":"run.start","title":"リポジトリの更新"}
{"apiVersion":1,"runId":"wts","seq":1,"type":"task.start","taskId":"operation","label":"リポジトリの更新"}
{"apiVersion":1,"runId":"wts","seq":2,"type":"task.finish","taskId":"operation","status":"succeeded"}
{"apiVersion":1,"runId":"wts","seq":3,"type":"run.finish","result":{"success":true}}
```

処理が例外で終了した場合は task を `failed`、run の結果を `success: false` として終了する。進捗終了の表示にも障害が起きた場合、呼び出し元には元の業務例外を返す。業務の失敗を表示障害で隠さない。

進捗の終了時は stdin を閉じ、最終応答と子プロセスの終了を待ってから結果表示や質問へ進む。例外時に残った子プロセスも終了させる。時間のかかる外部操作は非同期で実行し、捕捉する stdout・stderr は終了待機と並行して読み取る。同じ端末で進捗と質問を同時に描画しない。`run.finish` より前の EOF は hamio のエラーとなる。[連続表示の契約](https://github.com/9uiLe/hamio/blob/v0.1.0/docs/api.md#連続表示)

## バージョン固定と外部依存

wts が使用する hamio の製品と取得元は次の値で固定する。

| 項目 | 固定対象 |
| --- | --- |
| 製品 | [v0.1.0](https://github.com/9uiLe/hamio/releases/tag/v0.1.0)、API v1 |
| 製品ソース | [`1c266341fd4d62c9314f6654abda00cd223941fa`](https://github.com/9uiLe/hamio/tree/1c266341fd4d62c9314f6654abda00cd223941fa) |
| Nix パッケージ定義 | [`dd8c86c6923f692ef183152958147bf095e85daa`](https://github.com/9uiLe/hamio/tree/dd8c86c6923f692ef183152958147bf095e85daa) |
| 対象 | `aarch64-darwin` / 公開資産 `darwin-arm64` |
| 展開後バイナリ SHA-256 | `dd45f29f67ba6687a186a9004c616159f675d1409fe690edd7d6ceae284c4c82` |
| 公開 SBOM SHA-256 | `e8bfe95da32a03b74be808d048fc4365283660d64aaa22b38d21f7e9bc5f643c` |

[`flake.nix`](../flake.nix) は hamio input を上表の Nix パッケージ定義に固定し、`hamio.packages.aarch64-darwin.hamio` を devShell に含める。hamio の nixpkgs は提供元の `flake.lock` が定めるものを使い、wts の nixpkgs へ `follows` させない。[提供元の Nix 構成](https://github.com/9uiLe/hamio/blob/dd8c86c6923f692ef183152958147bf095e85daa/docs/distribution.md#nix-で導入する)

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

入出力の契約は次の範囲で検証する。実行方法と表示カタログの運用は [開発資料](development.md#検証を実行する)に定義する。

| 対象 | 証拠 |
| --- | --- |
| stdout・stderr、応答形式、失敗、API 上限と分割 | 実 hamio を使う [UI テスト](../tests/ui.test.ts) |
| TTY の肯定・否定・Ctrl-C・文字入力・JSON 時の非対話 | [端末テスト](../tests/terminal.test.ts) |
| 入出力に対応する Git・ファイルの状態 | 一時 Git リポジトリと bare origin を使う各コマンドのテスト |

依存の調査と監査は [依存の検証](development.md#依存の検証)に従う。wts の `bun.lock` と hamio の公開 SBOM は別々に照会する。hamio 本体と同梱 Bun は SBOM に照会用の PURL・CPE がないため、SBOM による脆弱性照会の対象外となる。SBOM と notices、提供元の [runtime 検証資料](https://github.com/9uiLe/hamio/blob/dd8c86c6923f692ef183152958147bf095e85daa/docs/research/runtime-review.md)を使い、確認できた部品と範囲外を区別する。

公開物の出所は `gh release verify`、`gh release verify-asset`、`gh attestation verify` で確認する。attestation の照合対象にはリポジトリ、release workflow、製品タグ `refs/tags/v0.1.0`、製品ソースコミット、GitHub-hosted runner を含める。監査・動作検証の結果は対象コミットを特定できる PR・CI・Release に記録し、[ビルド成果物](development.md#ビルド成果物)と [正式リリースの条件](development.md#正式リリースの条件)を満たす証拠として扱う。
