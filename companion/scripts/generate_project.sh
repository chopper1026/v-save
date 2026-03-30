#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname "$0")" && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)

if ! command -v xcodegen >/dev/null 2>&1; then
  echo "xcodegen 未安装，无法生成 Xcode 工程。" >&2
  exit 1
fi

cd "$ROOT_DIR"
xcodegen generate --spec "$ROOT_DIR/project.yml"
