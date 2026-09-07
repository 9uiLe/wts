#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 0 ]]; then
  echo "Usage: $0" >&2
  exit 1
fi

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."

if [[ "$(uname -s)" != Darwin || "$(uname -m)" != arm64 ]]; then
  echo "セットアップには Apple Silicon macOS が必要です。" >&2
  exit 1
fi
if ! command -v nix >/dev/null 2>&1; then
  echo "Nix をインストールし、nix-command と flakes を有効にしてください。" >&2
  exit 1
fi
if ! xcode-select -p >/dev/null 2>&1; then
  echo "Xcode Command Line Tools を xcode-select --install でインストールしてください。" >&2
  exit 1
fi

nix flake check --no-update-lock-file
./scripts/install-deps.sh
