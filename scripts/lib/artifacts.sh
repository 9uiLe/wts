#!/usr/bin/env bash

verify_artifacts() {
  local artifact_dir="$1"
  local binary_name=wts-macos-arm64
  local artifact actual_checksum expected_checksum

  for artifact in "$binary_name" "$binary_name.sha256" BUILD_INFO; do
    if [[ ! -f "$artifact_dir/$artifact" ]]; then
      echo "成果物が見つかりません: $artifact_dir/$artifact" >&2
      return 1
    fi
  done

  actual_checksum="$(cd -- "$artifact_dir" && shasum -a 256 "$binary_name")" || return 1
  expected_checksum="$(cat -- "$artifact_dir/$binary_name.sha256")" || return 1
  if [[ "$actual_checksum" != "$expected_checksum" ]]; then
    echo "バイナリの SHA-256 が一致しません。" >&2
    return 1
  fi
}
