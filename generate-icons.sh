#!/usr/bin/env bash
# Icon generation script (single entry point).
#
# Usage:
#   1. Put your icon (1024x1024 PNG recommended) at src-tauri/icons/icon.png
#   2. Run: ./generate-icons.sh
#
# What it does:
#   - validates the source icon is square (crops via ImageMagick/sips when possible)
#   - generates all Tauri icon formats (npx @tauri-apps/cli icon)
#   - syncs src-tauri/icons/android/* into src-tauri/gen/android/app/src/main/res/*
#     so the Tauri Android shell and the icon source never diverge
#
# Works on Linux and macOS. Requires node (for PNG header parsing and the Tauri CLI).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ICONS_DIR="$SCRIPT_DIR/src-tauri/icons"
SOURCE_ICON="$ICONS_DIR/icon.png"
ANDROID_RES_DIR="$SCRIPT_DIR/src-tauri/gen/android/app/src/main/res"
TEMP_ICON="$ICONS_DIR/_temp_icon.png"

echo "miyako icon generator"
echo "====================="

if [ ! -f "$SOURCE_ICON" ]; then
    echo "ERROR: source icon not found at $SOURCE_ICON" >&2
    echo "Put your PNG icon there first (1024x1024 recommended)." >&2
    exit 1
fi

echo "Source icon: $SOURCE_ICON"

# Read PNG dimensions from the IHDR chunk (cross-platform, no sips/ImageMagick needed).
read -r WIDTH HEIGHT < <(node -e '
const fs = require("fs");
const fd = fs.openSync(process.argv[1], "r");
const buf = Buffer.alloc(24);
fs.readSync(fd, buf, 0, 24, 0);
fs.closeSync(fd);
if (buf.readUInt32BE(0) !== 0x89504e47) {
  console.error("Not a PNG file");
  process.exit(1);
}
console.log(buf.readUInt32BE(16), buf.readUInt32BE(20));
' "$SOURCE_ICON")

echo "Source size: ${WIDTH}x${HEIGHT}"

if [ "$WIDTH" != "$HEIGHT" ]; then
    echo "Icon is not square; attempting to crop to square..."
    SIZE=$(( WIDTH < HEIGHT ? WIDTH : HEIGHT ))
    if command -v magick >/dev/null 2>&1; then
        magick "$SOURCE_ICON" -gravity center -crop "${SIZE}x${SIZE}+0+0" +repage "$TEMP_ICON"
        mv "$TEMP_ICON" "$SOURCE_ICON"
    elif command -v convert >/dev/null 2>&1; then
        convert "$SOURCE_ICON" -gravity center -crop "${SIZE}x${SIZE}+0+0" +repage "$TEMP_ICON"
        mv "$TEMP_ICON" "$SOURCE_ICON"
    elif command -v sips >/dev/null 2>&1; then
        # macOS fallback
        sips -c "$SIZE" "$SIZE" "$SOURCE_ICON" --out "$TEMP_ICON" > /dev/null
        mv "$TEMP_ICON" "$SOURCE_ICON"
    else
        echo "ERROR: icon is ${WIDTH}x${HEIGHT} (not square) and no ImageMagick/sips found." >&2
        echo "Provide a square PNG or install ImageMagick, then re-run." >&2
        exit 1
    fi
    echo "Cropped to ${SIZE}x${SIZE}"
fi

echo "Generating all icon formats..."
npx @tauri-apps/cli icon "$SOURCE_ICON"

# Keep the adaptive round-icon XML that the Tauri CLI does not generate.
ROUND_XML="$ICONS_DIR/android/mipmap-anydpi-v26/ic_launcher_round.xml"
if [ ! -f "$ROUND_XML" ]; then
    echo "WARNING: $ROUND_XML missing; round launchers will fall back to legacy PNGs." >&2
fi
# Sync Android icons into the Tauri Android shell so both stay identical.
if [ -d "$ANDROID_RES_DIR" ]; then
    echo "Syncing Android icons into $ANDROID_RES_DIR"
    while IFS= read -r -d '' file; do
        rel="${file#"$ICONS_DIR/android"/}"
        mkdir -p "$ANDROID_RES_DIR/$(dirname "$rel")"
        cp "$file" "$ANDROID_RES_DIR/$rel"
    done < <(find "$ICONS_DIR/android" -type f -print0)
else
    echo "NOTE: $ANDROID_RES_DIR does not exist yet."
    echo "Run 'npx tauri android init' first, then re-run this script to sync icons."
fi

echo ""
echo "Icon generation complete."
echo "Generated: icon.icns, icon.ico, PNG sizes, Android densities (mipmap-*)."
echo "Android shell res/ has been synchronized with src-tauri/icons/android."
