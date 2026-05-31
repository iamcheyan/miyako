#!/bin/bash

# 图标生成脚本
# 使用方法:
#   1. 将你的图标 (1024x1024 PNG) 放到 src-tauri/icons/icon.png
#   2. 运行: ./generate-icons.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ICONS_DIR="$SCRIPT_DIR/src-tauri/icons"
SOURCE_ICON="$ICONS_DIR/icon.png"

echo "🎵 NasMusicSync 图标生成器"
echo "========================="

# 检查源图标是否存在
if [ ! -f "$SOURCE_ICON" ]; then
    echo "❌ 错误: 找不到源图标 $SOURCE_ICON"
    echo ""
    echo "请先将你的图标 (1024x1024 PNG) 放到:"
    echo "  $SOURCE_ICON"
    exit 1
fi

echo "📁 源图标: $SOURCE_ICON"
echo ""

# 运行 Tauri 图标生成器
echo "⏳ 正在生成所有图标格式..."
npx @tauri-apps/cli icon "$SOURCE_ICON"

echo ""
echo "✅ 图标生成完成!"
echo ""
echo "生成的图标:"
echo "  - macOS: icon.icns"
echo "  - Windows: icon.ico"
echo "  - PNG: 32x32, 64x64, 128x128, 128x128@2x"
echo "  - iOS: 所有尺寸"
echo "  - Android: 所有密度"
echo ""
echo "🔄 重启应用以查看新图标"
