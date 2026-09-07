#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 0 ]]; then
  echo "Usage: $0" >&2
  exit 1
fi

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
source scripts/lib/artifacts.sh

nix develop --no-update-lock-file --command bun run build
verify_artifacts release
echo "wts-macos-arm64: OK"
