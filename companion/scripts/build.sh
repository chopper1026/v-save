#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname "$0")" && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
DERIVED_DATA_DIR="$ROOT_DIR/.derived-data"

"$SCRIPT_DIR/generate_project.sh"

xcodebuild \
  -project "$ROOT_DIR/VSaveCompanion.xcodeproj" \
  -scheme VSaveCompanion \
  -configuration Debug \
  -destination "platform=macOS" \
  -derivedDataPath "$DERIVED_DATA_DIR" \
  build
