# hamio 導入の根拠と API

確認日: 2026-09-20。wts の端末入出力を [9uiLe/hamio](https://github.com/9uiLe/hamio) に統一するため、公開資産、API v1、実装、同梱部品を確認した。Git・設定ファイルなどの業務上の入出力は wts が管理する。

## 採用する公開物

| 項目 | 固定対象 |
| --- | --- |
| 製品 | [v0.1.0](https://github.com/9uiLe/hamio/releases/tag/v0.1.0)、API v1 |
| 製品ソース | `1c266341fd4d62c9314f6654abda00cd223941fa` |
| Nix パッケージ定義 | [`dd8c86c6923f692ef183152958147bf095e85daa`](https://github.com/9uiLe/hamio/tree/dd8c86c6923f692ef183152958147bf095e85daa) |
| wts の対象 | `aarch64-darwin` / 公開資産 `darwin-arm64` |
| 展開後バイナリ SHA-256 | `dd45f29f67ba6687a186a9004c616159f675d1409fe690edd7d6ceae284c4c82` |
| 公開 SBOM SHA-256 | `e8bfe95da32a03b74be808d048fc4365283660d64aaa22b38d21f7e9bc5f643c` |

確認時点の公開製品は v0.1.0 一件で、2026-09-17 13:58:30 UTC に公開された。Nix パッケージはその後に追加され、製品タグ自身には含まれない。Nix 定義は v0.1.0 の gzip・checksum・SBOM・notices を個別の SHA-256 で取得し、展開後のバイナリも照合する。[固定情報](https://github.com/9uiLe/hamio/blob/dd8c86c6923f692ef183152958147bf095e85daa/nix/release.json)、[パッケージ定義](https://github.com/9uiLe/hamio/blob/dd8c86c6923f692ef183152958147bf095e85daa/nix/package.nix)

hamio は公開された TypeScript ライブラリではなく、JSON で呼ぶ独立した CLI である。`package.json` は `private: true` で、言語別 SDK を要求しない。[製品定義](https://github.com/9uiLe/hamio/blob/v0.1.0/package.json)、[API](https://github.com/9uiLe/hamio/blob/v0.1.0/docs/api.md)

開発環境には flake input と `hamio.packages.aarch64-darwin.hamio` を追加し、`flake.lock` で固定する。上流は、検証済み構成を保つため hamio の nixpkgs を利用側の nixpkgs に `follows` させない手順を定めている。配布済み wts からは PATH 上の `hamio` を実行するため、README・ビルド情報に外部要件を記載し、欠落時の動作を検証する。[Nix 導入手順](https://github.com/9uiLe/hamio/blob/dd8c86c6923f692ef183152958147bf095e85daa/docs/distribution.md#nix-で導入する)、[wts 開発資料](development.md)

## プロセス呼び出し

コマンド引数は配列で渡し、要求は JSON として渡す。正常な UI 操作は終了コード 0、入力不足は 3、不正値は 4、キャンセルは 130。業務の失敗を表示した場合でも UI 操作が成功すれば 0 になる。wts の業務終了コードを hamio の終了コードだけで決めない。[終了状態](https://github.com/9uiLe/hamio/blob/v0.1.0/docs/api.md#終了状態とエラー)

| コマンド | 入力の接続 | 出力の接続 |
| --- | --- | --- |
| `render --format human` | stdin に表示 JSON | 人向け表示は stderr、stdout は成功 JSON |
| `render --format json` | stdin に表示 JSON | stdout に成功 JSON と正規化した blocks、stderr は空 |
| `form --definition FILE --interactive always` | 定義は実ファイル、stdin は端末を継承 | 対話 UI は継承した stderr、回答 stdout は捕捉 |
| `form --definition FILE --interactive never --values -` | stdin に提供値の JSON | stdout に回答・不足・不正値の JSON |
| `stream --format human` | stdin に NDJSON | 人向け進捗は stderr、stdout は最終応答 |

`render` の最小要求と human 形式の応答は次のとおり。人向け出力に成功 JSON を混ぜない場合は stdout を捕捉する。[単発表示](https://github.com/9uiLe/hamio/blob/v0.1.0/docs/api.md#単発表示)

```json
{"apiVersion":1,"blocks":[{"kind":"message","level":"info","text":"処理を開始します"}]}
```

```json
{"apiVersion":1,"status":"ok"}
```

`message.level` は `info`・`success`・`warning`・`error`。ほかに `key-value`、`table`、`progress`、`result`、`error` がある。`key-value` は `items: [{label,value,secret?}]`、`table` は `columns: [{id,label,secret?}]` と `rows: [{columnId:value}]`、`result` は `success` と任意の `message`・`data` を取る。[表示の型](https://github.com/9uiLe/hamio/blob/v0.1.0/src/core/contract.ts)

### フォーム

確認は次の定義を一時ファイルへ保存し、`--definition` にそのパスを渡す。`--definition -` は拒否される。フォーム完了後は一時ファイルを除去する。[フォーム契約](https://github.com/9uiLe/hamio/blob/v0.1.0/docs/api.md#フォーム)

```json
{"apiVersion":1,"id":"wts","fields":[{"id":"answer","kind":"confirm","label":"続行しますか？"}]}
```

```json
{"apiVersion":1,"status":"ok","id":"wts","values":{"answer":false}}
```

| kind | 定義と回答 |
| --- | --- |
| `text` | `label`、任意の `minLength`・`maxLength`。回答は string |
| `confirm` | 回答は boolean、対話の初期選択は必ず否定 |
| `select` | `options: [{value,label}]`。回答は選んだ value の string |
| `multiselect` | 同じ options。回答は value の string[] |
| `secret` | 入力をマスクする text。default は禁止 |

各フィールドの `required` は既定 true。必須の不足項目だけを質問し、`default` は質問時の初期値ではなく回答として採用する。任意項目は未提供なら対話でも質問しない。必須 text は空文字を拒否し、任意入力の空文字、既存の初期選択、独自の検証関数はそのまま同じ定義へ変換できない。[値の解決](https://github.com/9uiLe/hamio/blob/v0.1.0/src/core/form.ts)、[対話実装](https://github.com/9uiLe/hamio/blob/v0.1.0/src/adapters/prompts.ts)

Ctrl-C・EOF・SIGINT・SIGTERM は `{"apiVersion":1,"status":"cancelled"}` と終了コード 130 になる。部分回答は返らない。wts ではキャンセルを正常終了へ変換する。[キャンセル応答](https://github.com/9uiLe/hamio/blob/v0.1.0/src/application/response.ts)、[wts の端末契約](design.md#端末-ui)

### 進捗

スピナー専用 API はない。`stream` へ `run.start`、`task.start`、`task.finish`、`run.finish` を順に送り、待機中の業務を表示する。すべての event に `apiVersion:1` と同じ `runId`、0 から連続する `seq` を付ける。[連続表示](https://github.com/9uiLe/hamio/blob/v0.1.0/docs/api.md#連続表示)

```jsonl
{"apiVersion":1,"runId":"wts","seq":0,"type":"run.start","title":"リポジトリの更新"}
{"apiVersion":1,"runId":"wts","seq":1,"type":"task.start","taskId":"fetch","label":"取得中"}
{"apiVersion":1,"runId":"wts","seq":2,"type":"task.finish","taskId":"fetch","status":"succeeded"}
{"apiVersion":1,"runId":"wts","seq":3,"type":"run.finish","result":{"success":true}}
```

`task.progress` を使う場合は `current` と `total` を送る。失敗時も task を `failed` で終了して run を確定する。`run.finish` より前の EOF はエラーになる。同じ端末への複数描画は禁止され、入力を始める前に進捗の task と run を終了する。非 TTY または `TERM=dumb` の human 形式では途中進捗を表示しない。[状態検証](https://github.com/9uiLe/hamio/blob/v0.1.0/src/core/session.ts)

### 端末条件と表示制約

`form --interactive auto` は stdin と stderr が TTY、`TERM != dumb`、`CI` が未設定または空の場合に対話する。`always` も stdin・stderr の TTY と `TERM != dumb` が必要。これは移行前 wts の stdin・stdout 判定と異なる。[コマンド解決](https://github.com/9uiLe/hamio/blob/v0.1.0/src/application/command.ts)

`--color auto` は stderr の TTY、`TERM`、`NO_COLOR` を参照し、`FORCE_COLOR` は参照しない。`--color always` は `NO_COLOR` より優先する。移行前 wts の優先順位を保つ場合は呼び出し側が `always` または `never` を決める必要がある。色を無効にしても、対話フォームのカーソル制御は残る。[API の対話・形式・色](https://github.com/9uiLe/hamio/blob/v0.1.0/docs/api.md#対話形式色)

human 表示は制御文字を無害化し、行を端末幅へ収める。非 TTY の既定幅は 80。table の表示は 20 行で省略され、JSON 形式では全行を返す。help やスキル本文などを一つの message に入れると全文を維持できない。[フォーマット](https://github.com/9uiLe/hamio/blob/v0.1.0/src/terminal/format.ts)、[文字処理](https://github.com/9uiLe/hamio/blob/v0.1.0/src/terminal/text.ts)

資源上限は API v1 の技術契約である。単発 JSON は 256 KiB、文字列は UTF-8 4,096 bytes、表示 block は 32、フォーム項目は 64、選択肢は 100、table は 16 列・200 行。これらを wts 独自の業務上限へ転用せず、変換時に実際の入力が収まるか確認する。[上限の定義](https://github.com/9uiLe/hamio/blob/v0.1.0/src/core/contract.ts)

## 依存と公開物の確認

hamio 本体は [MIT License](https://github.com/9uiLe/hamio/blob/v0.1.0/LICENSE)。配布物は Bun 1.4.2 と製品 JavaScript 依存を含む。2026-09-20 に取得した [macOS 公開 SBOM](https://github.com/9uiLe/hamio/releases/download/v0.1.0/hamio-v0.1.0-darwin-arm64.spdx.json) は上表の SHA-256 と一致し、`gh release verify`、`gh release verify-asset`、`gh attestation verify` が成功した。attestation は repository、release workflow、`refs/tags/v0.1.0`、製品ソース commit、GitHub-hosted runner を条件として検証した。

| 製品 JavaScript 部品 | 公開元・正確な版 | 依存先 |
| --- | --- | --- |
| `@clack/core` | [1.5.1](https://registry.npmjs.org/@clack/core/1.5.1) | `fast-wrap-ansi`、`sisteransi` |
| `fast-wrap-ansi` | [0.2.2](https://registry.npmjs.org/fast-wrap-ansi/0.2.2) | `fast-string-width` |
| `fast-string-width` | [3.0.2](https://registry.npmjs.org/fast-string-width/3.0.2) | `fast-string-truncated-width` |
| `fast-string-truncated-width` | [3.0.3](https://registry.npmjs.org/fast-string-truncated-width/3.0.3) | なし |
| `sisteransi` | [1.0.5](https://registry.npmjs.org/sisteransi/1.0.5) | なし |

上記五部品の SPDX 許諾は MIT。npm 公開メタデータの scripts に install・postinstall・prepare はない。二つの文字幅パッケージには公開時の `prepublishOnly` があるが、利用側のインストール処理ではない。wts ではこれらを npm 依存として追加せず、hamio の検証済み公開バイナリを利用する。[公開 SBOM](https://github.com/9uiLe/hamio/releases/download/v0.1.0/hamio-v0.1.0-darwin-arm64.spdx.json)、[固定された依存グラフ](https://github.com/9uiLe/hamio/blob/v0.1.0/bun.lock)

Bun は JavaScriptCore・native ライブラリ・polyfill を含む集約部品として SBOM に記録され、許諾は `NOASSERTION`。MIT のみとして扱えない。Nix メタデータは MIT と LGPL-2.1-only を記載し、[公開 notices](https://github.com/9uiLe/hamio/releases/download/v0.1.0/hamio-v0.1.0-darwin-arm64.notices.txt) と [Bun・native 部品の確認記録](https://github.com/9uiLe/hamio/blob/dd8c86c6923f692ef183152958147bf095e85daa/docs/research/runtime-review.md) に許諾元を示す。SBOM は Bun 内部を部品単位で網羅していない。

上流の 2026-09-17 の記録では `bun audit` が npm 46 パッケージを検査し検出 0、Bun の native 固定ソース 22 件の OSV 照会も検出 0。公開版の [build・候補検証](https://github.com/9uiLe/hamio/actions/runs/35229026857) と [公開後の導入試験](https://github.com/9uiLe/hamio/actions/runs/35230519812) は macOS 15 arm64 を含む三対象で成功した。前者の publish job は失敗し、所有者による公開と後者の導入試験を経て配布されている。workflow 全体が成功したとは扱わない。[リリース評価](https://github.com/9uiLe/hamio/blob/dd8c86c6923f692ef183152958147bf095e85daa/docs/release-readiness.md)

2026-09-20 の [hamio 公開 advisory API](https://api.github.com/repos/9uiLe/hamio/security-advisories) の応答は空配列だった。上流の過去の監査は導入時の監査と区別する。wts の `bun audit` と `osv-scanner` は [依存検証](development.md#依存の検証)で実行し、外部バイナリの SBOM は wts の `bun.lock` に含まれないため別に確認する。検出 0 は未公表の問題や SBOM 外の native 部品の安全性を証明しない。

同日に固定 devShell で実施した wts の `bun run verify:deps` は、`bun audit` と OSV-Scanner 2.5.1 の双方が終了コード 0、検出 0 だった。公開 SBOM を別途 OSV-Scanner で検査した結果も、識別できた npm 5 部品について検出 0、終了コード 0 だった。hamio 本体と同梱 Bun は SBOM に照会用の PURL・CPE がないため、この SBOM 検査の対象外である。実行記録は `release/AUDIT_INFO`、`release/bun-audit.json`、`release/osv-audit.json`、`release/hamio-osv-audit.json` と対応する stderr に保存する。

hamio の製品コードはローカルのファイルと標準入出力を使い、外部プロセス起動・ネットワーク取得・自動更新を設けていない。ビルド設定は `.env`・`bunfig.toml`・`package.json`・`tsconfig.json` の自動読み込みと依存の自動取得を無効にする。導入時の GitHub/Nix への通信と通常起動は別である。[プロセス境界](https://github.com/9uiLe/hamio/blob/v0.1.0/src/cli.ts)、[ビルド設定](https://github.com/9uiLe/hamio/blob/v0.1.0/scripts/build/compiler.ts)、[Nix 取得処理](https://github.com/9uiLe/hamio/blob/dd8c86c6923f692ef183152958147bf095e85daa/nix/package.nix)

## wts の移行検証

2026-09-20、Apple Silicon macOS と固定 devShell で確認した。CLI の入力・確認・結果・診断・進捗・ヘルプ・バージョン・同梱ガイドを hamio に移し、既存の直接 UI 依存を除去した。機械向け出力は NDJSON に変更し、対話の否定・Ctrl-C は正常終了として扱う。

- 整形検査、lint、`tsc --noEmit` は成功した。
- doctor の肯定・否定・Ctrl-C、文字入力の既定値・Unicode 入力・Ctrl-C、JSON 指定時の非対話を実 TTY で確認した。
- 全 236 テストが成功した。cleanup のテスト用 Git ラッパーをフック使用時だけ起動するように修正し、タイムアウトしていた `configured release/stable` のケースも Bun 既定の 5,000 ms で成功した。タイムアウト値、業務処理、既存の検証内容は変更していない。
- `./scripts/check.sh` が成功し、整形・lint・型・全テスト・ビルドと Apple Silicon バイナリの起動・SHA-256 照合を一括で確認した。
- 表示カタログは 247 ケースの収録と期待終了コードの照合に成功した。確認ダイアログの変更前後を画面で確認し、収録済みデータを新しい基準として採用した。

初回の命名スクリプト検証は、継承した `PYENV_DIR` が削除済みディレクトリを指して失敗した。この変数だけを検証時に除くと期待出力と引数が一致したため、環境設定の修正をコード変更には含めなかった。Bun の起動コマンド表示に含まれる色は `bun run --silent` で検査対象から除き、hamio の無色表示を確認した。

依存監査の結果と範囲は前節に記載する。実サービスへの接続、正式リリース、配布後の導入検証は実施していない。
