# wts の開発とリリース

wts の変更、検証、配布を担当する人向けの手順です。コマンドの使い方は [README](../README.md)、変更時の契約と権限は [AGENTS.md](../AGENTS.md) に従ってください。

## 開発環境

Apple Silicon Mac、Xcode Command Line Tools、`nix-command` と `flakes` を有効にした Nix が必要です。依存取得と監査にはネットワーク接続を使います。`setup.sh` は Nix と Xcode Command Line Tools 自体をインストールしません。

```bash
git clone https://github.com/9uiLe/wts.git
cd wts
./scripts/setup.sh
nix develop --no-update-lock-file --command bun run verify:deps
./scripts/check.sh
```

開発と CI の環境を揃えるため、Nix Flakes で開発ツール、Bun で JavaScript / TypeScript 依存を管理します。`flake.lock` と `bun.lock` を Git 管理し、通常の実行では更新せず、devShell 内の固定された Bun を使います。依存の再取得には `./scripts/install-deps.sh` を使います。依存追加・更新時は [依存の検証](#依存の検証) に従ってください。

devShell は CLI の入出力を担当する hamio v0.1.0 を PATH に提供します。バージョンと Nix 構成の固定方法、プロセス間の契約、外部バイナリの依存と検証範囲は [CLI 入出力と hamio の連携](hamio.md)に定義します。

## 開発セッション

このリポジトリの [.wts.json](../.wts.json) は、ベースを `master`、worktree の作成先をメインチェックアウトの隣の `wts-worktrees` に設定しています。[scripts/name-session.py](../scripts/name-session.py) による命名には Python 3 と認証済み Claude CLI が必要です。Claude の Haiku へ作業内容を送信し、`--dry-run` でも命名を実行します。

メインチェックアウトから、作成予定を確認してセッションを作ります。

```bash
./scripts/dev.sh config check
./scripts/dev.sh start --task '設定の診断を改善する' --dry-run
./scripts/dev.sh start --task '設定の診断を改善する'
```

`dev.sh` は、そのスクリプトが属するチェックアウトのソースを固定 Nix 環境で実行します。ビルドやインストールは不要です。作成される worktree のソースと設定はベースコミットの内容なので、作成結果の `Path` へ移動し、その worktree の `./scripts/setup.sh` で依存を取得してください。以後の実行と検証にも作業中の worktree のスクリプトを使います。

変更の積み重ねと更新は [セッションで作業する](../README.md#セッションで作業する)、削除は [マージ済みブランチの整理](../README.md#マージ済みブランチの整理) と [セッションの破棄](../README.md#セッションの破棄) に従い、例の `wts` を `./scripts/dev.sh` に置き換えます。削除は対象外のメインチェックアウトから行い、残すファイルと削除範囲を確認してください。PR の作成・マージは GitHub または gh で行います。

## 開発コマンド

スクリプトは自身の位置から wts のチェックアウトを特定します。`check-config.sh` は呼び出し元のプロジェクトを検査するため、現在のディレクトリを保持します。

| スクリプト | 用途・引数 |
| --- | --- |
| `./scripts/setup.sh` | 開発環境の確認と依存取得。引数なし |
| `./scripts/install-deps.sh` | 固定依存の取得。引数なし |
| `./scripts/dev.sh [CLI引数…]` | ソースから CLI を実行 |
| `./scripts/check-config.sh [設定ファイル]` | 呼び出し元プロジェクトまたは指定ファイルの設定検査 |
| `./scripts/build.sh` | ビルドと成果物照合。引数なし |
| `./scripts/check.sh` | 整形・lint・型・テスト・ビルドと成果物照合。引数なし |
| `./scripts/install.sh [--with-deps] [成果物ディレクトリ] [配置先ディレクトリ]` | [取得済み成果物の配置](#取得済み成果物からの導入) |

`check-config.sh` は任意のプロジェクトから絶対パスでも呼び出せます。検査範囲は [設定の検査](configuration.md#設定の検査) を参照してください。

個別の処理はリポジトリのルートで `nix develop --no-update-lock-file` を実行し、devShell 内で次のコマンドを使います。

| コマンド | 用途 |
| --- | --- |
| `bun run dev [CLI引数…]` | ソースから CLI を実行 |
| `bun run format` | Biome で整形し、ファイルを更新 |
| `bun run format:check` | ファイルを変更せず整形を検査 |
| `bun run lint` | `biome.json` に従って静的検査 |
| `bun run typecheck` | `tsconfig.json` に従って `tsc --noEmit` で型検査 |
| `bun run test` | 自動テスト |
| `bun run ui:catalog` | [端末 UI のレビュー資料](#端末-ui-の一覧と変更確認) を生成 |
| `bun run verify:deps` | 固定依存の取得と両監査 |
| `bun run build` | Apple Silicon 向けバイナリの生成と起動検証 |
| `bun run check` | 整形検査・lint・型検査・テスト・ビルド |

## 検証を実行する

変更が影響する契約に対応する証拠を選びます。整形、lint、型検査、振る舞い、依存監査、成果物照合は別の証拠です。Bun による実行や lint を型検査の代わりにしません。

| 変更の影響 | 必要な検証 |
| --- | --- |
| 文書・指示のみ | 差分、参照先、適用条件、既存契約との整合。実行コードや配布内容に影響しなければ CLI テストとビルドは不要 |
| TypeScript・JSON | `bun run format:check` と `bun run lint`。型に影響すれば `bun run typecheck`、振る舞いに影響すれば該当テスト |
| 同梱スキル | [スキルの保守](#ai-向けスキルの保守) に従って取得・導入・バイナリ埋め込みを検証 |
| 依存追加・更新 | [依存の検証](#依存の検証) |
| ビルド・配布 | Apple Silicon 上で `./scripts/build.sh` を実行し、バイナリ・SHA-256・`BUILD_INFO` を照合 |
| 対話 | 下記の TTY 検証。対話変更時は doctor の肯定・否定・Ctrl-C を必ず確認し、変更した操作の状態も確認 |

[CI](../.github/workflows/ci.yml) の `bun run check` と成果物照合は維持します。検証結果は該当する PR・CI・Release に、対象コミット、環境、入力、観測結果、未検証条件を記載してください。自動テスト、実サービス、配布経路で得た証拠を区別し、認証情報や秘密情報は記録しません。

### 自動テスト

[tests/helpers/](../tests/helpers/) を使い、一時 Git リポジトリと bare origin、利用者の Git 設定と wts 環境変数を隔離した環境で実行します。環境変数による入力と非対話の条件は CLI の入口から検証します。共通の fixture と実行処理をテストごとに重複定義しません。

命名、GitHub、Homebrew の応答と障害は一時ファイル・テスト用コマンドで再現します。実サービスの認証、システムへの依存導入、実際の開発 worktree や公開リモートへの削除・push は自動テストで行いません。

### 性能を比較する

[`scripts/benchmark.ts`](../scripts/benchmark.ts) は、基準バイナリと比較対象バイナリを同じ一時リポジトリで実行し、時間、Git・hamio の起動数、バイナリサイズ、最大 RSS を記録します。バイナリは同じビルド設定で用意し、固定 devShell から実行してください。

基準にするリビジョンで `./scripts/build.sh` を実行し、生成したバイナリを別名で保存します。

```bash
mkdir -p release/performance
cp release/wts-macos-arm64 release/performance/baseline-wts
```

比較対象のリビジョンを同じ設定でビルドしてから、両方のバイナリを指定します。

```bash
nix develop --no-update-lock-file --command bun scripts/benchmark.ts release/performance/baseline-wts dist/wts-macos-arm64 --output release/performance/comparison.json
```

| 測定項目 | 入力・方法 |
| --- | --- |
| 起動 | `--version` を実行 |
| 一覧 | 1 セッションと 10 セッション。各セッションはルートと 3 スタックブランチを持つ |
| 削除予定 | ルートを含む 10 ブランチのセッションに `discard --dry-run` を実行 |
| 時間 | 両バイナリを交互に実行し、ウォームアップ 1 回後の 5 サンプルと中央値を記録 |
| 起動数・メモリ | 時間計測とは別の実行で Git・hamio の起動数と macOS の最大 RSS を採取 |

セッション数は、入力の桁を変えたときの増加傾向を観察するための条件です。時間のサンプル数と中央値は測定手順を揃えるために使い、合否の閾値は設けません。最大 RSS は OS の報告値であり、同時に動く全プロセスのメモリ合計ではありません。

測定用リポジトリはリモートを持たず、通信は行いません。実行前後の参照、worktree 登録、メイン作業ツリーの状態が変わらないことを照合します。JSON の結果には環境、測定条件、全時間サンプル、バイナリの SHA-256 とサイズを含めます。実サービスや別の入力規模の性能は、その条件で測定してください。

### 対話と状態の検証

固定 devShell の TTY 上で入力、終了コード、操作後の状態を確認します。CLI の直接起動と `bun run dev` 経由の実行は区別し、実行していない経路を検証済みと扱いません。

| 対象 | 入力条件 | 期待する結果 |
| --- | --- | --- |
| `bun run dev doctor --interactive` | 肯定・否定・Ctrl-C | 終了コード `0`、Git 参照不変 |
| `bun run dev restack --dry-run` | CLI・環境変数・設定のベースを省略。`origin/HEAD` の有無ごとに「既定値を使う」を Enter で選択・Ctrl-C | 候補は `origin/HEAD` の参照、なければ `origin/main`。終了コード `0`、参照・lease 不変 |
| `bun run dev discard <検証用path>` | ローカルだけ・`--remote origin` の各条件で承認・否定・Ctrl-C | 承認時は指定範囲を削除。否定・Ctrl-C は状態不変。終了コード `0` |

restack の push 確認には、入力ごとに独立したセッションと bare origin を用意し、rebase で OID が変わり push が必要な状態にします。`PUSH`・`PUSH_ONLY`・`DRY_RUN` を unset し、`bun run dev restack --base-branch origin/main` を実行します。

| push 確認 | ローカル参照 | origin | lease |
| --- | --- | --- | --- |
| 肯定 | rebase 後の OID | rebase 後の OID | 除去 |
| 否定・Ctrl-C | rebase 後の OID | 不変 | 保持 |

いずれも終了コード `0` と元の checkout への復帰を確認します。push の確認時点で rebase は完了しているため、否定・キャンセルでもローカル参照は元に戻りません。削除の保護条件、参照競合、段階ごとの失敗は [discard のテスト](../tests/discard.test.ts) で検証します。

### AI 向けスキルの保守

[skills/wts-cli/SKILL.md](../skills/wts-cli/SKILL.md) は操作依頼の選択とガイド取得の入口、[references/guide.md](../skills/wts-cli/references/guide.md) は CLI の操作手順です。実行する CLI と手順の版を揃えるため、導入するのは入口だけとし、ガイドは実行バイナリから取得します。取得・導入には PATH 上の hamio が必要ですが、Git リポジトリ、設定、通信、実行時のソースファイルを要求しません。入口に配布されない参照ファイルへのリンクを追加しないでください。

description は wts の実操作を対象にし、ソースや文書を編集するだけの依頼では発動させません。ガイドは操作に必要な節へ案内し、特定のモデルだけを前提にしません。この保守方針は OpenAI Developers の [Rethinking skills and prompts for GPT-6 Astra](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra) を参考にしています。

コマンドの入力、操作範囲、復旧方法を変えたら対応するガイドも更新します。導入先は `--path` で選べ、AI 製品の設定ファイルは変更しません。既存の同内容は変更せず成功し、異なる内容の置き換えは `--force` を要求します。他ファイルの保持、配置先ディレクトリの symlink と通常ファイル以外の `SKILL.md` の拒否を維持してください。

スキル内容の取得と入口の導入は次のコマンドで確認できます。`--path` は検証用のスキル親ディレクトリにします。

```bash
./scripts/dev.sh --format json skills get wts-cli
./scripts/dev.sh skills install wts-cli --path /path/to/test-skills
```

文面の変更でも、固定 devShell 内の `bun test tests/skills.test.ts` と `./scripts/build.sh` で検証します。ビルド検証はリポジトリ外・PATH に hamio だけがある環境で取得・導入し、JSON 応答の result ブロックに含まれる `data.lines` を改行で結合してソースの内容と一致することを確認します。description の適用条件、参照節、非対話オプション、承認範囲も差分で照合してください。これらは AI 製品上の発動精度や複数モデルの実動作を保証しません。実際の読み込み・呼び出しは別の証拠として扱います。

### 端末 UI の一覧と変更確認

定義したケースで実 CLI の出力を静的 HTML に収録し、全体の一貫性と採用済み表示との差分を確認します。リポジトリのルートで生成してください。

```bash
nix develop --no-update-lock-file --command bun run ui:catalog
```

`release/ui-catalog/index.html` をブラウザーで開き、変更された文言・配色・入力・終了コードと全体の表示を確認します。対話は「入力前」の画面も確認してください。HTML はサーバー不要で単体共有でき、CI の `terminal-ui-review` アーティファクトからも取得できます。

| `release/ui-catalog/` のファイル | 用途 |
| --- | --- |
| `index.html`、`changes.html` | 全件または変更件を初期表示するレビュー画面 |
| `captures.json`、`comparison.json` | 生の収録結果とケースごとの変更判定の調査 |
| `coverage.md` | 疑似応答の範囲と未実測条件の確認 |
| `failure.txt`、`partial-captures.json` | 生成失敗時の診断と部分収録。HTML にも失敗を表示し、終了コードは `1` |

`tests/fixtures/ui-baseline.json` は担当者が明示的に採用する Git 管理の基準版です。通常の収録が成功すれば、差分があっても終了コードは `0` です。表示を確認して採用を決めた後だけ、次を実行します。

```bash
nix develop --no-update-lock-file --command bun run ui:catalog --update-baseline tests/fixtures/ui-baseline.json
nix develop --no-update-lock-file --command bun run format
```

UI と基準版を同じ変更単位でコミットします。この実行の HTML は更新前の基準との比較です。更新後の基準と比較する場合は通常の生成を実行します。別の基準や出力先は devShell 内で `bun run ui:catalog --baseline /path/to/baseline.json --output release/ui-review` と指定できます。

表示設計と無関係な差分を除くため、一時パス・日付・UUID・OID を正規化し、スピナーの更新回数を比較対象から外します。文言・色・入力前画面・入力・コマンド・終了コードは比較します。収録は隔離した一時環境と疑似応答を使い、実サービスへの接続結果を保証しません。詳しい未実測条件は生成された `coverage.md` を確認してください。

表示分岐を追加したら [scripts/ui-catalog/](../scripts/ui-catalog/) に到達条件と期待する終了コードを持つケースを追加します。タイトルは基準版との対応キーなので、表示文言だけの変更では変えません。条件を変えたケースは追加・削除としてレビューします。

## 依存の検証

依存追加・更新時は、公開元、ライセンス、リリース履歴、既知の脆弱性、スクリプト、推移的依存、予期しない通信を確認し、必要性と更新理由を PR またはコミットに記録します。通常の取得は `bun install --frozen-lockfile --ignore-scripts` とし、未レビューの依存更新、ロックファイル差し替え、インストールスクリプト実行は行いません。

固定 devShell 内で `bun run verify:deps` を実行し、`bun audit` と `osv-scanner` の両方の成功を確認します。診断資料は `release/` に生成されます。

| ファイル | 用途 |
| --- | --- |
| `DEPENDENCIES.json` | パッケージのメタデータと導入状態の確認 |
| `bun-audit.json`、`osv-audit.json` | 脆弱性監査結果の確認 |
| `bun-audit.stderr`、`osv-audit.stderr` | 監査コマンドの診断の調査 |
| `AUDIT_INFO` | 問い合わせ日時・ツール・データベース・終了コード・例外の確認 |

## ビルド成果物

Apple Silicon macOS 上で `./scripts/build.sh` を実行します。`bun-darwin-arm64` 向けバイナリの生成と起動検証を同じ環境で行います。バージョンは通常 `package.json` を使い、公開用には追跡ファイルを変更せずビルド時に埋め込みます。

```bash
WTS_RELEASE_VERSION=0.2.0-rc.1 ./scripts/build.sh
```

指定は先頭 `v` なしの SemVer です。生成物は `dist/wts-macos-arm64` と、配布する次の一組です。`dist/` と `release/` は Git 管理しません。

```text
release/wts-macos-arm64
release/wts-macos-arm64.sha256
release/BUILD_INFO
```

`BUILD_INFO` はバージョンとターゲット、生成元コミット、作業ツリー・ツール・環境・依存の状態、外部要件、署名・公証の状態を示す配布資料です。バイナリとの対応を確認するため同じビルドの一組を扱います。成果物の種別は `build_kind=verification_only` で、Pre-release もこの種別です。起動検証の成功だけで正式公開可能とは判断しません。

`build.sh` と `check.sh` は成果物の存在とチェックサムを照合します。手動で照合する場合は `release/` 内で実行します。

```bash
shasum -a 256 -c wts-macos-arm64.sha256
```

## 取得済み成果物からの導入

GitHub Releases からの取得とローカル配置を分けたい場合や、自分でビルドした成果物を導入する場合に使います。wts のリポジトリを clone し、同じ Release のバイナリ・SHA-256・`BUILD_INFO` を `/path/to/downloads` に揃えて実行します。Nix は不要で、macOS の標準コマンドを使います。

```bash
./scripts/install.sh /path/to/downloads
```

成果物ディレクトリの既定値はリポジトリの `release/`、配置先の既定値は `~/.local/bin` です。第 2 引数で配置先を変えられます。相対パスは呼び出し時のディレクトリを基準に解釈します。

`--with-deps` を明示すると、成果物検証後に Homebrew の `brew install git gh` を実行し、成功後に配置します。Homebrew がない場合や導入に失敗した場合は配置しません。hamio は [README の手順](../README.md#インストール)で別途導入します。Homebrew 自体、命名スクリプトの依存、認証は自動設定しません。

利用中の wts を壊さないため、両インストーラーは配置前に成果物を検証し、同じディレクトリの一時ファイルから置き換えます。既存の `wts` は通常ファイルかつ非 symlink が必要で、検証・配置失敗時は既存ファイルを保持します。署名・公証、Gatekeeper 許可、シェル設定の自動変更は行いません。PATH の登録は [README のインストール手順](../README.md#インストール) に従い、導入後は `wts doctor --check` で依存と認証を確認してください。

## Pre-release の公開手順

[Release workflow](../.github/workflows/release.yml) は、最低対応 macOS と署名・公証方針が未確定のため、検証用 Pre-release を公開します。依存監査と `./scripts/check.sh` に加え、固定した hamio を PATH に追加した Nix devShell 外で生成バイナリのバージョンと起動を確認します。公開ジョブ以外に書き込み権限を与えず、アクションはコミット SHA に固定してください。

初回はリポジトリの Actions 設定とタグルールで `GITHUB_TOKEN` による Release・タグ作成を許可し、**Settings → Pages → Build and deployment → Source** を **GitHub Actions** に設定します。

1. 公開対象と影響が承認されていることを確認し、**Actions → Release → Run workflow** を開きます。
2. ブランチに `master`、`version` に先頭 `v` なしの SemVer を指定します。公開対象はチェックアウト時点の最新 `master` です。`master` 以外では公開されません。
3. 成功後、GitHub Releases の `v<version>` が Pre-release で、バイナリ・SHA-256・`BUILD_INFO` が添付されていることを確認します。
4. Pages 配信後、`https://9uile.github.io/wts/channel.txt` が `v<version>` の 1 行で、`https://9uile.github.io/wts/install.sh` を取得できることを確認します。

公開対象のすり替わりや重複公開を防ぐため、ビルド前後に最新 `master`、最新公開 Release、バージョンとタグの未使用を検査します。最新公開 Release と同じコミット、使用済みバージョン、処理中の `master` 更新、API の取得・応答検証の失敗は公開を止めます。入力にプレリリース識別子がなくても公開状態は必ず Pre-release です。

Release は直列実行し、進行中の実行を自動キャンセルしません。成果物のアップロードが揃ってから下書きを公開します。失敗時は Releases とタグの状態を確認してください。既存の下書きやタグは再実行で上書き・削除せず、使用済みバージョンとして拒否します。`master` 更新による停止は最新 `master` で再実行します。Release 本文のテンプレートは workflow が保持し、配布条件や未検証範囲を変えるときは同時に更新してください。

### Pages の再配信

Pre-release を既定の導入対象に選び、インストール時の GitHub API 呼び出しを不要にするため、配布対象タグを Pages の `channel.txt` で指定します。利用者が未完成の Release を取得しないよう、Release 公開後にインストーラーとタグを同じ Pages 配信で切り替えます。

Pages 配信の失敗から復旧する場合や既存 Release を選び直す場合は、[Pages workflow](../.github/workflows/pages.yml) の **Run workflow** で `master` と公開済みの `version`（先頭 `v` なし）を指定します。公開済み Release と 3 成果物を検査して配信し、Release やタグは作り直しません。

既定のインストール対象は最後に成功した Pages 配信のタグであり、バージョン番号順や Latest API では選びません。Pages を取得できない場合、バージョン未指定のインストールは失敗します。

### 実機での配布経路の検証

配布経路を通した実機での導入・更新・実動作と、Gatekeeper の挙動・許可手順は未検証です。検証担当者は Apple Silicon Mac の通常のターミナルで、Nix devShell を終了して次を確認します。対象コミット・配布タグ・macOS・CPU・入力・終了コード・結果を該当する PR または Release に記載してください。

1. `sw_vers` と `uname -m`、Pages の `channel.txt`、対象 Release の `BUILD_INFO` で環境と成果物を特定します。
2. [README のインストール](../README.md#インストール) に従い、配置先と PATH を確認します。新しいターミナルで `wts --version` が対象 Release と一致すること、`wts --help`、`wts doctor`、`wts doctor --check` の結果を確認します。
3. Gatekeeper の制限の有無を記録します。制限がある場合は表示内容、実施した許可操作、その後の起動結果を記録します。インストーラーは隔離属性の削除やセキュリティ設定変更を行いません。
4. `wts doctor --interactive` の肯定・否定・Ctrl-C が終了コード `0` になることを確認します。
5. 検証用リポジトリで [README の操作手順](../README.md#プロジェクトを初期化する) に従い、`init`、`config check`、`start`、`stack`、`restack`、`cleanup` を確認します。必要な Git・gh・認証を用意し、push・PR のマージ・worktree の削除も検証用の対象だけに行います。実行していないコマンドは未検証と記録します。
6. wts を終了し、別の公開済み Release を同じインストールコマンドで導入してバージョン更新と起動を確認します。更新先がなければ更新は未検証と記録します。

CI や自動テストの成功から、実サービスへの接続、配布経路、対応 macOS、Gatekeeper を検証済みと判断しません。

## 正式リリースの条件

正式公開には、次の条件をすべて満たす必要があります。

- 最低対応 macOS を決め、対象環境で起動、コマンド、対話入力、キャンセル、終了を検証する。
- Nix 環境外で、GitHub Releases からの導入と更新を検証する。
- Developer ID 署名・公証の採否を決める。採用する場合は最終バイナリへの適用・検証後にチェックサムを生成する。採用しない場合は対象 macOS の Gatekeeper の挙動と許可手順を検証し、制約と手順を Release 本文に記載する。
- レビュー済みコミットとクリーンな作業ツリーから生成して Apple Silicon 上で実行し、依存監査、CI の ARM64 実行結果、成果物と `BUILD_INFO` の整合、最終バイナリのチェックサムを確認する。
- 公開先の権限とリリース承認を確認し、バイナリ・チェックサム・ビルド情報を一組で公開する。
