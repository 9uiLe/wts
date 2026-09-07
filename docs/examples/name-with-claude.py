#!/usr/bin/env python3
import json
import re
import subprocess
import sys


def main():
    context = json.load(sys.stdin)
    prompt = context["prompt"] + "\n\nタスク: " + context["task"]
    result = subprocess.run(
        ["claude", "-p", "--model", "haiku", prompt],
        capture_output=True,
        text=True,
        check=True,
    )
    raw = next((line.strip() for line in result.stdout.splitlines() if line.strip()), "")
    slug = re.sub(r"[`\"']", "", raw).lower().rstrip(".。")
    if len(slug) > 50 or not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", slug):
        raise ValueError("Claude が有効なスラッグを返しませんでした")
    if context["kind"] == "branch" and "rootBranch" not in context:
        print(context["date"] + "-" + slug)
    else:
        print(slug)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, subprocess.SubprocessError):
        print("命名に失敗しました。設定と Claude CLI を確認してください。", file=sys.stderr)
        sys.exit(1)
