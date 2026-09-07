#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 0 ]]; then
  echo "Usage: $0" >&2
  exit 1
fi

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
nix develop --no-update-lock-file --command bun run build
cd release
shasum -a 256 -c wts-macos-arm64.sha256
