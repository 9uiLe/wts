#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
exec nix develop --no-update-lock-file "$repo_root" --command bun "$repo_root/src/cli.ts" config check "$@"
