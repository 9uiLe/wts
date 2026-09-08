#!/usr/bin/env python3
import json
import re
import subprocess
import sys


def main():
    context = json.load(sys.stdin)
    result = subprocess.run(
        [
            "claude", "-p", "--model", "haiku", "--tools", "",
            "--no-session-persistence",
            context["prompt"] + "\n\nタスク: " + context["task"],
        ],
        capture_output=True,
        text=True,
        check=True,
        stdin=subprocess.DEVNULL,
    )
    slug = result.stdout.strip()
    if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", slug):
        raise ValueError("命名結果は英小文字・数字・ハイフンの一行である必要があります")
    print(slug if "rootBranch" in context else context["date"] + "-" + slug)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, subprocess.SubprocessError):
        print("命名に失敗しました。Python 3 と認証済み Claude CLI を確認してください。", file=sys.stderr)
        sys.exit(1)
