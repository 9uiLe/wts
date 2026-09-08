#!/usr/bin/env bash

# パイプの途中で取得が途切れた場合、関数の解析が完了するまで配置処理を実行しない。
wts_install() (
  set -euo pipefail

  local version='' install_dir="${HOME:?HOME が未設定です}/.local/bin"
  local temporary='' staged=''

  fail() { printf '%s\n' "$*" >&2; exit 1; }

  usage() {
    echo 'Usage: bash install.sh [--version <SemVer>] [--install-dir <directory>]'
    echo '既定: 配布チャネルのバージョンを ~/.local/bin に配置します。'
  }

  valid_version() {
    local number='(0|[1-9][0-9]*)'
    local identifier='(0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)'
    local pattern="^$number\.$number\.$number(-$identifier(\.$identifier)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$"
    [[ "$1" =~ $pattern ]]
  }

  parse_arguments() {
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --help|-h) usage; exit 0 ;;
        --version|--install-dir)
          [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || fail "$1 の値が必要です。"
          if [[ "$1" == --version ]]; then
            valid_version "$2" || fail 'バージョンには先頭 v なしの SemVer を指定してください。'
            version="$2"
          else
            install_dir="$2"
          fi
          shift 2 ;;
        *) fail "不明な引数: $1" ;;
      esac
    done
  }

  check_environment() {
    local command
    for command in uname curl mktemp rm cat shasum mkdir chmod mv; do
      command -v "$command" >/dev/null 2>&1 || fail "必要なコマンドが見つかりません: $command"
    done
    [[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] || fail 'インストールには Apple Silicon macOS が必要です。'
    [[ "$install_dir" == /* ]] || install_dir="$PWD/$install_dir"
  }

  cleanup() {
    [[ -z "$staged" ]] || rm -f -- "$staged"
    [[ -z "$temporary" ]] || rm -rf -- "$temporary"
  }

  prepare_workspace() {
    trap cleanup EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
    temporary="$(mktemp -d "${TMPDIR:-/tmp}/wts-install.XXXXXX")" || fail '一時ディレクトリを作成できません。'
  }

  download() {
    curl --proto '=https' --proto-redir '=https' --fail --silent --show-error --location --output "$2" "$1" || fail "取得できません: $1"
  }

  resolve_version() {
    if [[ -z "$version" ]]; then
      download 'https://9uile.github.io/wts/channel.txt' "$temporary/channel.txt"
      local tag
      tag="$(cat "$temporary/channel.txt")"
      [[ "$tag" == v* ]] && valid_version "${tag#v}" || fail '配布チャネルのバージョンが不正です。'
      version="${tag#v}"
    fi
  }

  download_release() {
    local base="https://github.com/9uiLe/wts/releases/download/v$version" artifact
    for artifact in wts-macos-arm64 wts-macos-arm64.sha256 BUILD_INFO; do
      download "$base/$artifact" "$temporary/$artifact"
    done
  }

  verify_release() {
    local key value build_version='' target='' version_count=0 target_count=0
    while IFS='=' read -r key value || [[ -n "$key" ]]; do
      case "$key" in
        version) build_version="$value"; version_count=$((version_count + 1)) ;;
        target) target="$value"; target_count=$((target_count + 1)) ;;
      esac
    done < "$temporary/BUILD_INFO"
    [[ "$version_count" == 1 && "$build_version" == "$version" && "$target_count" == 1 && "$target" == bun-darwin-arm64 ]] || fail 'BUILD_INFO の version または target が一致しません。'
    local actual expected
    actual="$(cd "$temporary" && shasum -a 256 wts-macos-arm64)" || fail 'SHA-256 を計算できません。'
    expected="$(cat "$temporary/wts-macos-arm64.sha256")"
    [[ "$actual" == "$expected" ]] || fail 'バイナリの SHA-256 が一致しません。'
  }

  install_binary() {
    mkdir -p -- "$install_dir" || fail "配置先を作成できません: $install_dir"
    [[ ! -L "$install_dir/wts" && ( ! -e "$install_dir/wts" || -f "$install_dir/wts" ) ]] || fail '配置先の wts は通常ファイルである必要があります。'
    staged="$(mktemp "$install_dir/.wts.XXXXXX")" || fail '配置用の一時ファイルを作成できません。'
    cat "$temporary/wts-macos-arm64" > "$staged" || fail '配置用ファイルを書き込めません。'
    chmod 755 "$staged" || fail '実行権限を設定できません。'
    mv -f -- "$staged" "$install_dir/wts" || fail 'wts を配置できません。'
    staged=''
  }

  print_path_instructions() {
    case ":${PATH:-}:" in
      *":$install_dir:"*) return ;;
    esac
    echo 'wts を直接実行するには、zsh のターミナルで次を一度実行してください。'
    if [[ "$install_dir" == "$HOME/.local/bin" ]]; then
      printf '%s\n' "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.zshrc"
    else
      local path_setting
      printf -v path_setting 'export PATH=%q:"$PATH"' "$install_dir"
      printf "  printf '%%s\\\\n' %q >> ~/.zshrc\n" "$path_setting"
    fi
    echo '  source ~/.zshrc'
    echo '新しく開いたターミナルでも有効です。'
  }

  print_completion() {
    printf 'wts %s をインストールしました: %s/wts\n' "$version" "$install_dir"
    print_path_instructions
    printf '動作確認: wts --version\nヘルプ: wts --help\n環境検査: wts doctor --check\n'
    echo 'GitHub CLI の認証が未設定の場合: gh auth login'
  }

  parse_arguments "$@"
  check_environment
  prepare_workspace
  resolve_version
  download_release
  verify_release
  install_binary
  print_completion
)
wts_install "$@"
