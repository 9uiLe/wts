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
artifact_dir="${1:-$repo_root/release}"
install_dir="${2:-$HOME/.local/bin}"
binary_name=wts-macos-arm64

for artifact in "$binary_name" "$binary_name.sha256" BUILD_INFO; do
  if [[ ! -f "$artifact_dir/$artifact" ]]; then
    echo "成果物が見つかりません: $artifact_dir/$artifact" >&2
    exit 1
  fi
done

actual_checksum="$(cd -- "$artifact_dir" && shasum -a 256 "$binary_name")"
expected_checksum="$(cat -- "$artifact_dir/$binary_name.sha256")"
if [[ "$actual_checksum" != "$expected_checksum" ]]; then
  echo "バイナリの SHA-256 が一致しません。" >&2
  exit 1
fi

mkdir -p -- "$install_dir"
install -m 755 -- "$artifact_dir/$binary_name" "$install_dir/wts"
echo "インストールしました: $install_dir/wts"
