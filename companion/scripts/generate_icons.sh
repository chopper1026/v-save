#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname "$0")" && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
BUILD_DIR="$ROOT_DIR/build"
SVG_PATH="$BUILD_DIR/icon.svg"
PNG_PATH="$BUILD_DIR/icon.png"
ASSET_CATALOG_DIR="$ROOT_DIR/VSaveCompanion/Assets.xcassets"
APPICON_DIR="$ASSET_CATALOG_DIR/AppIcon.appiconset"

if [[ ! -f "$SVG_PATH" ]]; then
  echo "缺少图标母稿: $SVG_PATH" >&2
  exit 1
fi

if ! command -v qlmanage >/dev/null 2>&1; then
  echo "qlmanage 未安装，无法从 SVG 渲染图标。" >&2
  exit 1
fi

if ! command -v sips >/dev/null 2>&1; then
  echo "sips 未安装，无法导出 PNG 图标。" >&2
  exit 1
fi

mkdir -p "$BUILD_DIR" "$ASSET_CATALOG_DIR" "$APPICON_DIR"

tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT

qlmanage -t -s 1024 -o "$tmpdir" "$SVG_PATH" >/dev/null
mv "$tmpdir/$(basename "$SVG_PATH").png" "$PNG_PATH"

ICONSET_DIR="$tmpdir/icon.iconset"
mkdir -p "$ICONSET_DIR"

typeset -A exports=(
  [icon_16x16.png]=16
  [icon_16x16@2x.png]=32
  [icon_32x32.png]=32
  [icon_32x32@2x.png]=64
  [icon_64x64.png]=64
  [icon_128x128.png]=128
  [icon_128x128@2x.png]=256
  [icon_256x256.png]=256
  [icon_256x256@2x.png]=512
  [icon_512x512.png]=512
  [icon_512x512@2x.png]=1024
)

for name size in ${(kv)exports}; do
  sips -s format png -z "$size" "$size" "$PNG_PATH" --out "$ICONSET_DIR/$name" >/dev/null
done

cp "$ICONSET_DIR/icon_16x16.png" "$APPICON_DIR/icon_16x16.png"
cp "$ICONSET_DIR/icon_16x16@2x.png" "$APPICON_DIR/icon_16x16@2x.png"
cp "$ICONSET_DIR/icon_32x32.png" "$APPICON_DIR/icon_32x32.png"
cp "$ICONSET_DIR/icon_32x32@2x.png" "$APPICON_DIR/icon_32x32@2x.png"
cp "$ICONSET_DIR/icon_128x128.png" "$APPICON_DIR/icon_128x128.png"
cp "$ICONSET_DIR/icon_128x128@2x.png" "$APPICON_DIR/icon_128x128@2x.png"
cp "$ICONSET_DIR/icon_256x256.png" "$APPICON_DIR/icon_256x256.png"
cp "$ICONSET_DIR/icon_256x256@2x.png" "$APPICON_DIR/icon_256x256@2x.png"
cp "$ICONSET_DIR/icon_512x512.png" "$APPICON_DIR/icon_512x512.png"
cp "$ICONSET_DIR/icon_512x512@2x.png" "$APPICON_DIR/icon_512x512@2x.png"

echo "图标资源已更新:"
echo "  SVG  : $SVG_PATH"
echo "  PNG  : $PNG_PATH"
echo "  Assets.xcassets/AppIcon.appiconset"
