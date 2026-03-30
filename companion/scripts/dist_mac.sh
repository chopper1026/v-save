#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname "$0")" && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
DERIVED_DATA_DIR="$ROOT_DIR/.derived-data"
RELEASE_DIR="$ROOT_DIR/release"
APP_PATH="$DERIVED_DATA_DIR/Build/Products/Release/V-SAVE Companion.app"

"$SCRIPT_DIR/generate_project.sh"

xcodebuild \
  -project "$ROOT_DIR/VSaveCompanion.xcodeproj" \
  -scheme VSaveCompanion \
  -configuration Release \
  -destination "platform=macOS" \
  -derivedDataPath "$DERIVED_DATA_DIR" \
  build

mkdir -p "$RELEASE_DIR"
rm -rf "$RELEASE_DIR/V-SAVE Companion.app"
cp -R "$APP_PATH" "$RELEASE_DIR/V-SAVE Companion.app"
