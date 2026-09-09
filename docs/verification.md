# wts の検証記録

検証対象は [実装仕様](specification.md)に定義するCLI、Git操作、設定、コピー、端末表示、配布処理である。再現手順は [開発資料](development.md#検証を実行する)に記載する。

## 環境と入力

Apple Silicon macOS 上で、`flake.lock` に固定した Nix devShell の Bun 1.3.13 を使用する。JavaScript / TypeScript 依存は `bun.lock` に固定する。

Git操作には一時リポジトリとローカルbare originを使い、ユーザーのGit設定とwts環境変数を隔離する。GitHubの照会・認証・障害はテスト用コマンドで再現する。削除・pushの対象は検証用リポジトリに限る。

## 自動検証

`./scripts/check.sh` は整形・lint・型検査・テスト・Apple Silicon向けビルド・起動確認・成果物照合を実行する。テストは出力、終了コード、Git参照、worktree、設定、leaseを観測する。

2026年9月9日、作業ツリーの実装に対して `./scripts/check.sh` が終了コード `0` で成功した。

| 検証 | 結果 |
| --- | --- |
| Biome整形・lint | 成功 |
| TypeScript `tsc --noEmit` | 成功 |
| 自動テスト | 22ファイル、228テスト成功、失敗0、1,016 assertions |
| `bun-darwin-arm64` ビルドと起動 | 成功 |
| バイナリ・SHA-256・`BUILD_INFO` の成果物照合 | 成功 |

検証結果は正式公開の承認や配布経路の実機検証を意味しない。

## 対話と表示

2026年9月9日、以下のTTY検証が固定Bunの疑似端末で成功した。doctorは`bun run dev doctor --interactive`、restackはCLI直接起動を使用する。

| 対象 | 入力 | 確認項目 |
| --- | --- | --- |
| doctor | 肯定・否定・Ctrl-C | 終了コード0、Git参照不変 |
| restackのpush確認 | 独立セッションごとに肯定・否定・Ctrl-C | rebase後OID、origin更新または保持、lease除去または保持、元checkoutへの復帰 |
| restackのベース入力 | origin/HEAD有無それぞれのEnter・Ctrl-C | 候補表示、終了コード0、dry-runで参照・lease不変 |
| discard | ローカル／リモート指定それぞれの肯定・否定・Ctrl-C | 削除範囲、否定・キャンセル時の状態保持 |

2026年9月9日のUIカタログ検証では120桁・40行で247ケースの収録が成功し、表示基準との差分は0件だった。表示基準は`tests/fixtures/ui-baseline.json`、HTMLと収録データは`release/ui-catalog/`に保存する。比較対象は文言・色・入力前画面・入力・終了コードで、日付・UUID・一時パス・OID・スピナー更新回数を正規化する。

## 検証範囲の限界

GitHubサービスへの実接続、配布経路を通した実機での導入・更新、Gatekeeperの挙動と許可手順、最低対応macOS、署名・公証は、この自動検証から保証できない。正式公開には [正式リリースの条件](development.md#正式リリースの条件)を満たす必要がある。

restackのTTY検証は`bun run dev`ラッパー経由の実行を含まない。カタログの未実測条件は生成された`coverage.md`に記載する。
