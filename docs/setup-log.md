# 初期環境構築の記録

2026-09-07、指定資料 `cli-tech-stack.md` に沿って、CLI 名を `wts` として開発環境を構築した。既存 README の Git Worktree Session という名称を維持し、業務機能を決める前に開発・検証・ビルドを実行できる状態にするため、CLI は help、version、対話確認用 doctor のみ用意した。

Nixpkgs のリビジョンを flake.lock に固定し、Bun 1.3.13 と OSV-Scanner 2.5.1 を devShell で提供する。npm 依存は完全バージョンと bun.lock で固定した。表示上の用途がない Chalk と Ora は追加していない。

依存監査は [Bun の npm advisory API](https://bun.com/docs/pm/cli/audit) と、[bun.lock 対応の OSV-Scanner](https://google.github.io/osv-scanner/supported-languages-and-lockfiles/)を併用した。取得済みパッケージのメタデータで公開元・ライセンス・インストールスクリプトを確認できるよう一覧を生成する。今回インストールされた依存のライセンスは MIT または Apache-2.0 で、インストール時スクリプトはなかった。別 OS 向けの TypeScript optional dependencies はロックに含まれるが未インストールとして記録する。

macOS 26.5.2 / arm64 で以下を確認した。

- Nix Flake の評価と、固定 devShell の起動。
- frozen lockfile インストール、Bun audit と OSV-Scanner の終了コード 0。監査日時と結果は release/AUDIT_INFO、詳細は同ディレクトリの JSON に記録。リモート API が公開しないデータベースのスナップショット日時は推定しない。
- TypeScript 型チェックと CLI の振る舞いを確認する 5 テストが成功。
- 単体実行ファイルの生成、Mach-O arm64 の確認、SHA-256 照合が成功。
- Nix/Bun を含まない PATH で生成バイナリの version と doctor が成功。
- PTY で対話の肯定入力と Ctrl-C キャンセルを確認。

生成物は未コミットの作業ツリーからの検証用ビルドとして BUILD_INFO に記録した。最低対応 macOS、Developer ID 署名・公証、Gatekeeper と Releases 経由での導入、GitHub Actions 上での実行は未検証であり、正式リリースは行っていない。
