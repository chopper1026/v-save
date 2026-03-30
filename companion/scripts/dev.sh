#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname "$0")" && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
DERIVED_DATA_DIR="$ROOT_DIR/.derived-data"
APP_PATH="$DERIVED_DATA_DIR/Build/Products/Debug/V-SAVE Companion.app"

"$SCRIPT_DIR/build.sh"

open "$APP_PATH"
