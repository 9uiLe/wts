#!/usr/bin/env bash
set -euo pipefail

if [[ $# -gt 2 ]]; then
  echo "Usage: $0 [成果物ディレクトリ] [インストール先ディレクトリ]" >&2
  exit 1
fi
if [[ "$(uname -s)" != Darwin || "$(uname -m)" != arm64 ]]; then
  echo "インストールには Apple Silicon macOS が必要です。" >&2
  exit 1
fi

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib/artifacts.sh
source "$repo_root/scripts/lib/artifacts.sh"

artifact_dir="${1:-$repo_root/release}"
install_dir="${2:-$HOME/.local/bin}"
verify_artifacts "$artifact_dir"

mkdir -p -- "$install_dir"
install -m 755 -- "$artifact_dir/wts-macos-arm64" "$install_dir/wts"
echo "インストールしました: $install_dir/wts"
