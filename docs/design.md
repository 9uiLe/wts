# wts の設計

wts は、Git worktree 上で作成・積み重ね・更新・整理を行うセッション管理 CLI である。プロジェクト設定は、セッションのベースブランチ、作業場所、命名規則を定義する。配布対象は Apple Silicon macOS の単体実行ファイルとする。利用の入口と用語は [README](../README.md)、設定と命名スクリプトの契約は [設定資料](configuration.md)、開発・公開手順は [開発資料](development.md)、選択理由は [設計判断](decisions.md)に置く。

## ドメインと永続状態

セッションは一つの worktree、ルートブランチ、そのルートに属するスタックブランチを持つ。ルートを番号 1 とし、`<root>-pr<n>-<名前>` 形式のローカルブランチを番号順に列挙する。番号は GitHub の PR 番号とは独立している。

| 状態 | 保存場所 | 用途 |
| --- | --- | --- |
| プロジェクト設定 | `.wts.json` | ベースブランチ、worktree の作成先と命名規則 |
| セッション識別情報 | worktree 専用の Git ディレクトリの `wts-session.json` | `rootBranch` によるセッションの識別 |
| リモート参照のスナップショット | 同じ Git ディレクトリの `restack-lease` | rebase 後の push で照合する OID |
| 管理外ファイルの指定 | 実行元 worktree の `.worktree-copy` | start 時のコピー対象 |

worktree 名からルートブランチを推測しない。stack と restack はセッション識別情報と設定の管理範囲を検査する。cleanup は独自に PR とローカル変更を調査し、セッション識別情報の存在だけを削除根拠にはしない。

## 実装の責務

CLI の入口は引数をコマンドへ渡す。各コマンドは操作の順序を決め、Git・設定・命名・対話などの共通処理を利用する。

| 実装 | 責務 |
| --- | --- |
| `src/cli.ts` | Commander のコマンド定義、引数と環境変数の受け取り、エラー終了 |
| `src/commands/start.ts` | 名前とベースの確定、worktree 作成、セッションの記録、コピーの実行 |
| `src/commands/stack.ts` | 先端とクリーン状態の確認、番号と名前の確定、ブランチ作成 |
| `src/commands/restack.ts` | スタックの検証、rebase、lease の保存と atomic push |
| `src/commands/cleanup.ts` | PR とコミットの照合、削除候補の提示、worktree とブランチの整理 |
| `src/commands/init.ts`、`src/commands/config.ts` | 設定初期化と検査の操作 |
| `src/commands/doctor.ts` | 実行情報の表示、OS・依存・GitHub 認証の検査 |
| `src/commands/skills.ts` | 操作ガイドの標準出力とスキル導入結果の表示 |
| `src/skills.ts` | 埋め込みスキルの定義、配置先の検査とファイルの導入 |
| `skills/wts-cli/` | AI 向けのスキル定義と操作ガイド |
| `src/git.ts` | 引数配列による外部実行、Git 参照と worktree の取得・検査 |
| `src/project.ts` | 実行元とメインチェックアウトの特定、設定の読み込み、ローカルのベース名と origin 参照の導出、操作時のベース参照の確定 |
| `src/session.ts` | セッション識別情報とスタックの列挙 |
| `src/config.ts` | 設定データとベース名の検証、パスと実行権限の検証 |
| `src/naming.ts` | 日付＋UUID の生成、命名スクリプトとの入出力、名前の検証 |
| `src/prompts.ts` | Clack による入力・確認、キャンセルの扱い |
| `src/terminal.ts` | 出力先ごとの TTY 判定、色と端末機能の利用条件 |
| `src/ui.ts` | 出力の階層・状態色・詳細行、非同期処理中の進捗 |
| `src/copy.ts` | 管理外ファイルの列挙と境界を検査したコピー |
| `src/version.ts` | ソースとバイナリの表示バージョン |

## AI 向けスキル

`skills/wts-cli/SKILL.md` は AI がスキルを選択し、操作ガイドを取得するための入口である。`skills/wts-cli/references/guide.md` はコマンドの選択、非対話入力、実行範囲と復旧手順を定義する。両方をテキストとしてバイナリに埋め込む。

`skills get wts-cli` は埋め込んだガイドを装飾なしで標準出力へ返す。`skills install wts-cli` は入口だけを `<親ディレクトリ>/wts-cli/SKILL.md` へ配置する。親ディレクトリの既定値は `~/.agents/skills` とし、`--path` の相対パスは実行時のディレクトリを基準にする。どちらの操作も Git リポジトリ、プロジェクト設定、外部コマンド、実行時のソースファイル、ネットワーク接続に依存しない。利用可能なスキル名は `wts-cli` のみとする。

導入は同一内容なら変更せず成功し、異なる内容の通常ファイルは `--force` 指定時だけ置き換える。配置先の `wts-cli` ディレクトリがシンボリックリンクの場合と、既存の `SKILL.md` が通常ファイルでない場合は拒否する。スキルディレクトリ内の他のファイルは保持する。

## プロジェクト設定とベース参照

セッション操作は `.wts.json` を検証してから進む。設定ファイルの探索順・パス基準・既定値・命名プロトコルは [設定資料](configuration.md)を正本とする。実行中の worktree とメインチェックアウトの設定をマージせず、探索で選ばれた一つのファイルを操作に使う。

`baseBranch` はリモート名を含まないローカルブランチ名として扱う。設定からローカル名と `origin/<baseBranch>` を導出する処理を共有し、cleanup の保護対象と取り込み判定が同じベースを指すようにする。

start と restack は、コマンドラインオプション、環境変数、明示されたプロジェクト設定の順にベース参照を確定する。いずれも指定されていない場合は `origin/main` を初期値とする対話で確定する。cleanup はプロジェクト設定を使用し、`baseBranch` 省略時は `main` を保護して `origin/main` への取り込みを判定する。

## 操作の不変条件

start は名前と既存ブランチ・パスの衝突を検査してから作成する。命名スクリプトが失敗した場合は中止し、別の名前へ置き換えない。コピーは worktree と Git 管理情報の境界を検査し、シンボリックリンクを持ち込まない。

stack はクリーンな作業ツリーとスタック先端での実行を要求する。restack は線形で、他の worktree で使用されていないスタックを要求する。push は rebase 開始時に保存した origin の OID を明示的な lease とし、atomic に行う。リモート確認や lease が不足する場合は push しない。

cleanup はマージ済み PR とローカル変更の取り込みを証明できるブランチを削除候補にする。解決したローカルのベースブランチ、実行中のブランチ、管理範囲外の worktree で使用中のブランチは除外する。fetch・祖先判定・パッチ一致には、同じベースの origin 参照を使う。削除候補の worktree は強制削除の対象であり、未コミット・管理外ファイルの保持は保証しない。

対話の否定・Ctrl-C は正常終了する。必要な入力を受け取れない非対話環境ではエラーにする。外部コマンドは引数配列で実行し、入力をシェル式として解釈しない。

`--dry-run` は wts による fetch、ブランチ・worktree・ファイル・セッション情報・lease の変更と push を抑制する。PR 情報とリモート参照の取得、命名スクリプトの実行は行う。

## 端末 UI

コマンドは共通 UI を通して見出し、操作対象、実行予定、結果、診断を表示する。通常の結果は stdout、警告・エラー・進捗は stderr に出す。Chalk は状態色と情報の強弱、Ora は進捗、Clack は入力と確認を担当する。色を使わない出力でも、状態を文言と記号で識別できるようにする。

端末機能は出力先ごとに判定する。非 TTY、CI、`TERM=dumb` では見出しの装飾と進捗アニメーションを使用しない。`NO_COLOR` の指定と `FORCE_COLOR=0` は色を無効にし、`NO_COLOR` がある場合は `FORCE_COLOR` より優先する。Clack の出力も同じ色方針に従い、色を無効にする際はカーソル制御を保持する。

外部処理は非同期に実行し、待機中の進捗描画と端末入力を処理する。スピナーは処理結果にかかわらず停止し、結果表示と対話入力の前に端末を復元する。確認のキャンセルは一度だけ表示して正常終了する。

## 端末 UI カタログ

カタログは、コマンドごとの表示と採用済みの表示との差分を確認する静的 HTML である。ケースの実行、端末画面の再現、基準版との比較、レビュー画面の生成を分担する。

| 実装 | 責務 |
| --- | --- |
| `scripts/ui-catalog.ts` | ケースの収録、基準版の読み書き、生成物の保存 |
| `scripts/ui-catalog/capture.ts` とケース定義 | 実行環境の準備、CLI の実行、入力と終了結果の検査 |
| `scripts/ui-catalog/terminal-renderer.ts` | ANSI 出力から端末画面を再現 |
| `scripts/ui-catalog/normalize.ts`、`comparison.ts` | 可変値の正規化、基準版との比較、比較結果の型 |
| `scripts/ui-catalog/render.ts` | 比較結果からレビュー画面を構成 |
| `scripts/ui-catalog/page-assets.ts` | 画面の配色・配置、ブラウザー内の表示切替と絞り込み |
| `scripts/ui-catalog/html.ts` | HTML に埋め込む文字列のエスケープ |

### 収録と比較

ケースは実行条件、入力、期待する終了コードを持つ。CLI を擬似端末またはパイプで実行し、入力待ちと終了結果を検査する。対話では入力前の画面と最終画面を収録する。Git は一時リポジトリとローカル bare origin を使用し、外部サービスと障害はテスト用コマンドで再現する。

端末画面は ANSI のカーソル移動、消去、色、日本語の文字幅を反映して再現する。一時パス、生成名、Git OID などの可変値を正規化し、画面、入力、コマンド、終了コードを比較する。進捗の描画回数は比較対象に含めない。

基準版は Git 管理の収録 JSON とし、明示的な採用操作で更新する。ケースのタイトルを対応キーとして、変更なし、変更あり、追加、削除を判定する。生成失敗は診断ページで示し、未実測の条件は収録範囲に明記する。

### レビュー画面

画面は対象件数、操作部、ケース一覧の順に構成する。操作部には件数付きの「全件」「変更のみ」、検索、コマンド絞り込みを置く。各操作は見出しとその下の入力欄・選択肢を一組とし、選択状態を文字と配色で示す。固定表示する操作部は画面上端から 16px の余白を取り、ケースへの移動時に見出しを隠さない。狭い画面では要素を縦に並べ、高さが不足する画面では固定を解除する。

変更なしのケースは「出力」を一つ表示する。変更ありのケースは「変更前」「変更後」を並べて変更行を強調し、追加・削除のケースは該当する出力を表示する。各ケースにコマンド、入力、終了コードを添え、入力前画面は展開して確認できるようにする。

変更が0件の状態と、検索・絞り込みに一致しない状態を区別し、それぞれ全件表示と絞り込み解除への操作を示す。ケース番号とリンク先は表示範囲を切り替えても維持する。

各 HTML に全ケースと操作機能を内包し、ブラウザー内で表示を切り替える。レビュー画面は表示の確認に使い、端末の収録データ、比較判定、収録範囲は開発・調査用ファイルとして保存する。生成物とレビュー手順は [開発資料](development.md#端末-ui-の一覧と変更確認)に定義する。

## 環境検査とインストール

doctor の実行情報表示は外部コマンドを要求しない。`doctor --check` は OS・Git・gh と認証、任意の Claude CLI を検査する。`config check` は設定を検証し、命名スクリプトは実行しない。両検査とも環境の導入・変更は行わず、認証情報を表示しない。

`web-install.sh` はリポジトリの clone を要求せず、Pages の `channel.txt` または `--version` で選択した同じ Release からバイナリ・SHA-256・`BUILD_INFO` を取得する。SHA-256 とビルド情報のバージョン・ターゲットを検証してから配置する。Git・gh の導入、認証、Gatekeeper の許可は行わない。

`install.sh` は取得済みのローカル成果物を検証し、`--with-deps` 指定時に Homebrew へ Git・gh の導入を委ねてから wts を配置する。Homebrew、任意の命名環境、認証は利用者が用意する。

## 開発・配布基盤

| 実装・設定 | 責務 |
| --- | --- |
| `flake.nix`、`flake.lock` | `aarch64-darwin` 向け開発ツールと Nixpkgs の固定 |
| `package.json`、`bun.lock`、`bunfig.toml` | Bun のコマンド、依存とレジストリ |
| `biome.json`、`tsconfig.json` | 整形・lint・型の規則 |
| `tests/` | CLI、セッション、設定、配布処理の観測可能な振る舞いの検証 |
| `scripts/*.sh` | 固定 Nix 環境での開発操作と、macOS 上の配置操作の入口 |
| `scripts/lib/artifacts.sh` | ビルド・検査・配置に共通の成果物検証 |
| `scripts/verify-dependencies.sh`、`scripts/dependency-inventory.ts` | 固定依存の取得・棚卸し・監査 |
| `scripts/build.ts` | コンパイル、起動検証、チェックサム・ビルド情報の生成 |
| `scripts/release-version.ts`、`scripts/check-release.ts` | 公開バージョンと公開対象の検証 |
| `scripts/ui-catalog.ts`、`scripts/ui-catalog/` | ケース実行、端末表示の収録・正規化、基準版との比較と静的 HTML 生成 |
| `.github/workflows/ci.yml`、`.github/workflows/release.yml` | 通常検証と Pre-release 公開 |
| `.github/workflows/pages.yml` | 公開済み Release の確認とインストーラー・配布対象タグの Pages 配信 |

開発用スクリプトはリポジトリの Flake を `nix develop --no-update-lock-file` で使用する。設定検査は呼び出し元ディレクトリを保持する。配布バイナリと配置スクリプトは Nix を要求しない。具体的なコマンドは [開発資料](development.md#開発コマンド)に定義する。

## バージョン

ソース実行時は `package.json` のバージョンを表示する。ビルド時は `WTS_RELEASE_VERSION` が指定されていればその SemVer を、未指定なら `package.json` のバージョンを使用する。先頭 `v`、不正な識別子、余分な空白を含む入力は拒否する。

ビルドで選んだ値を `WTS_BUILD_VERSION` としてコンパイル時に埋め込み、バイナリの表示と `BUILD_INFO` に同じ値を使用する。実行時の環境変数は配布バイナリのバージョンを変更しない。公開のために `package.json` とロックファイルを書き換える必要はない。

## 検証と依存監査

Biome の既定 formatter と recommended lint、TypeScript の `tsc --noEmit`、Bun のテスト、生成バイナリの起動検証をそれぞれの責務として分ける。`bun run check` は整形検査、lint、型検査、テスト、ビルドを順に実行する。

依存は `--frozen-lockfile --ignore-scripts` でインストールする。依存一覧にはロック内の取得先と SHA-512 integrity の有無、取得済みパッケージのバージョン、公開元、ライセンス、インストールスクリプトを記録する。別 OS 向けの optional dependencies など、未インストールの項目は `installed: false` とする。

既知の脆弱性は `bun audit` と OSV-Scanner へ照会し、両方の終了コードが `0` の場合に成功とする。照会日時、ツール、取得先、終了コード、例外、結果、標準エラーを監査資料へ記録する。API が公開しないデータベースのスナップショット日時は推定しない。依存一覧と監査結果は、ソースコード全体の安全性やライセンス適合性の承認を意味しない。

## 成果物の契約

ビルドと起動検証の実行環境は Apple Silicon macOS、コンパイル先は `bun-darwin-arm64` とする。生成したバイナリのバージョン一致、ヘルプの CLI 名、`doctor` の正常終了を確認してから配布用ディレクトリへコピーする。

配布単位はバイナリ、SHA-256、`BUILD_INFO` の組とする。`scripts/lib/artifacts.sh` は各ファイルの存在とバイナリの SHA-256 を検証し、ビルド・検査・配置の入口が同じ条件を使用する。チェックサムの対象名にはバイナリの basename を用い、取得先の同じディレクトリで照合できる形式にする。成果物のパスと照合操作は [開発資料](development.md#ビルド成果物) に記載する。

`BUILD_INFO` は生成日時、バージョン、Git コミット、作業ツリーの状態、Bun・Nix・OS・Xcode Command Line Tools、ターゲット、ロックファイルの SHA-256、最低対応 macOS、署名・公証、外部要件を記録する。変更のある作業ツリーから生成した場合は `git_worktree=dirty` とし、コミットだけで生成元を特定できるとは扱わない。

成果物は常に `build_kind=verification_only` とする。最低対応 macOS は未確定で、Developer ID 署名・公証は行わない。GitHub Actions での起動検証と、ダウンロードしたファイルの Gatekeeper を含む検証は別の証拠として扱う。正式公開の条件は [開発資料](development.md#正式リリースの条件) に定義する。

## 公開判定

Release ワークフローは `master` を選択した手動実行だけを受け付ける。入力は先頭 `v` なしの SemVer とし、タグ名を `v<version>` とする。入力にプレリリース識別子があるかどうかによらず、GitHub 上の公開状態は Pre-release に固定する。

対象コミットはチェックアウトした最新 `master` の HEAD とする。ビルド前後に GitHub API で次を検査する。

- リモートの `master` と HEAD が一致する。`master` が進んでいる場合はエラーにする。
- Release 一覧の全ページから、下書きを除き `published_at` が最大の Release を選ぶ。Pre-release も含み、GitHub の「Latest」ラベルやバージョン番号順は使用しない。
- 最新公開 Release のタグをコミット SHA に解決し、`master` と一致すればエラーにする。注釈付きタグも同じ比較を行う。公開済み Release がない場合は初回公開を許可する。
- 入力から生成したタグ、または同じタグ名の Release が存在すればエラーにする。Release の重複判定には下書きも含める。

API の認証・通信・タグ解決の失敗は判定失敗として扱い、公開へ進めない。

## 公開の境界

通常の CI は `contents: read` で検証を行う。Release ワークフローでは Release 公開ジョブだけに `contents: write` を与え、`GITHUB_TOKEN` でタグと Release を作成する。GitHub Actions の参照はコミット SHA に固定する。

公開処理は確定したコミットにタグを作成し、成果物を下書き Release に添付した後、Pre-release として公開する。GitHub の「Latest」には指定しない。失敗時に残った下書きやタグは自動で削除・上書きせず、次の実行でも重複判定の対象とする。

同じ Release ワークフローの実行は直列化する。公開直前の再検査はビルド中の更新を検出するが、検査と公開を単一のトランザクションにはしない。公開対象には検証したコミット SHA を明示し、その後のブランチ更新によって対象が変わらないようにする。

## インストーラーの配信

GitHub Pages は単独実行できる `install.sh` と `channel.txt` を配信し、バイナリ・SHA-256・`BUILD_INFO` は GitHub Releases から取得する。`channel.txt` は先頭 `v` 付きの SemVer タグを 1 行で保持する。バージョン未指定時の対象はこのタグであり、GitHub の Latest API やバージョン番号順による選択は行わない。

Release の公開成功後に Pages ワークフローを呼び出す。Pages ワークフローは公開済み Release と 3 ファイルの存在を検査し、インストーラーとタグを一つの Pages 成果物として配信する。手動実行でも既存 Release のバージョンを必須とし、Release やタグは作成しない。最後に成功した Pages 配信が既定のインストール対象を決める。Pages の更新失敗は公開済み Release を取り消さない。

Pages 配信には `pages: write` と `id-token: write` を与える。利用者のインストールは GitHub REST API への認証やトークンを要求しない。
