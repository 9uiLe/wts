#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 [--with-deps] [成果物ディレクトリ] [インストール先ディレクトリ]"
  echo "  --with-deps  Homebrew で git と gh を導入します。"
}

with_deps=false
positional=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-deps) with_deps=true ;;
    --help|-h) usage; exit 0 ;;
    --) shift; positional+=("$@"); break ;;
    -*) echo "不明なオプション: $1" >&2; usage >&2; exit 1 ;;
    *) positional+=("$1") ;;
  esac
  shift
done
if [[ ${#positional[@]} -gt 2 ]]; then
  usage >&2
  exit 1
fi
set -- "${positional[@]+"${positional[@]}"}"
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

if [[ "$with_deps" == true ]]; then
  if ! command -v brew >/dev/null 2>&1; then
    echo "Homebrew が見つかりません。https://brew.sh/ の手順で導入してください。" >&2
    exit 1
  fi
  brew install git gh
fi

mkdir -p -- "$install_dir"
[[ ! -L "$install_dir/wts" && ( ! -e "$install_dir/wts" || -f "$install_dir/wts" ) ]] || {
  echo "配置先の wts は通常ファイルである必要があります。" >&2
  exit 1
}
staged=''
cleanup() { [[ -z "$staged" ]] || rm -f -- "$staged"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
staged="$(mktemp "$install_dir/.wts.XXXXXX")"
install -m 755 -- "$artifact_dir/wts-macos-arm64" "$staged"
mv -f -- "$staged" "$install_dir/wts"
staged=''
echo "インストールしました: $install_dir/wts"
echo "GitHub CLI の認証が未設定の場合: gh auth login"
printf '環境を検査: %q doctor --check\n' "$install_dir/wts"
