#!/usr/bin/env bash
set -euo pipefail

# deploy-emulator.sh
# 一键部署应用到 Android 模拟器

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_PROJECT_DIR="$ROOT_DIR/src-tauri/gen/android"

# 设置环境变量
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
if [ ! -d "${ANDROID_HOME:-}" ]; then
  export ANDROID_HOME="$HOME/Library/Android/sdk"
fi
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$ROOT_DIR/src-tauri/gen/android/.gradle-home}"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

step() {
  printf "\n${GREEN}==> %s${NC}\n" "$1"
}

warn() {
  printf "${YELLOW}⚠️  %s${NC}\n" "$1"
}

fail() {
  printf "${RED}❌ Error: %s${NC}\n" "$1" >&2
  exit 1
}

# 检查必要的工具
command -v npm >/dev/null || fail "npm 未找到"
command -v adb >/dev/null || fail "adb 未找到"
[ -x "$JAVA_HOME/bin/java" ] || fail "JDK 未找到"
[ -d "$ANDROID_PROJECT_DIR" ] || fail "Android 项目未找到。请先运行: npx tauri android init --ci"

# 步骤 1: 检查并启动模拟器
step "检查模拟器状态"
EMULATOR_COUNT=$(adb devices | grep -c "emulator-" || echo "0")
REAL_DEVICE_COUNT=$(adb devices | awk 'NR > 1 && $2 == "device" && $1 !~ /emulator-/ { count++ } END { print count + 0 }')

if [ "$EMULATOR_COUNT" -eq 0 ]; then
  warn "未找到运行中的模拟器"

  # 列出可用的 AVD
  step "查找可用的 Android 虚拟设备"
  AVAILABLE_AVDS=$("$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" list avd 2>/dev/null | grep -o "Name: .*" | sed 's/Name: //' || true)

  if [ -z "$AVAILABLE_AVDS" ]; then
    fail "没有找到任何 Android 虚拟设备。请先创建一个 AVD。"
  fi

  echo "可用的虚拟设备:"
  echo "$AVAILABLE_AVDS"

  # 选择第一个可用的 AVD
  FIRST_AVD=$(echo "$AVAILABLE_AVDS" | head -n 1)
  warn "将启动模拟器: $FIRST_AVD"

  step "启动 Android 模拟器"
  "$ANDROID_HOME/emulator/emulator" -avd "$FIRST_AVD" -no-snapshot-load &
  EMULATOR_PID=$!

  # 等待模拟器启动
  step "等待模拟器启动（最多 2 分钟）"
  for i in $(seq 1 120); do
    BOOT_COMPLETED=$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || echo "")
    if [ "$BOOT_COMPLETED" = "1" ]; then
      step "✅ 模拟器已启动完成"
      break
    fi

    if [ $i -eq 120 ]; then
      fail "模拟器启动超时（2 分钟）"
    fi

    if [ $((i % 10)) -eq 0 ]; then
      warn "仍在等待模拟器启动... ($i 秒)"
    fi
  done
else
  step "✅ 已找到 $EMULATOR_COUNT 个模拟器"
  adb devices -l
fi

# 步骤 2: 确定使用哪个设备
step "选择目标设备"

if [ "$REAL_DEVICE_COUNT" -gt 0 ] && [ "$EMULATOR_COUNT" -eq 0 ]; then
  warn "检测到真实设备，但本脚本专用于模拟器"
  warn "建议断开真实设备或指定模拟器"
fi

# 获取第一个可用的设备
DEVICE_SERIAL=$(adb devices | awk 'NR > 1 && $2 == "device" && $1 ~ /emulator-/ { print $1; exit }')
if [ -z "$DEVICE_SERIAL" ]; then
  DEVICE_SERIAL=$(adb devices | awk 'NR > 1 && $2 == "device" { print $1; exit }')
fi

if [ -z "$DEVICE_SERIAL" ]; then
  fail "没有找到可用的设备"
fi

echo "使用设备: $DEVICE_SERIAL"

# 步骤 3: 构建 APK
step "构建 APK (debug 模式)"
cd "$ROOT_DIR"

# 同步图标
ICON_DIR="$ROOT_DIR/src-tauri/icons/android"
RES_DIR="$ANDROID_PROJECT_DIR/app/src/main/res"
if [ -d "$ICON_DIR" ] && [ -d "$RES_DIR" ]; then
  step "同步 Android 图标"
  while IFS= read -r -d '' file; do
    rel="${file#$ICON_DIR/}"
    mkdir -p "$RES_DIR/$(dirname "$rel")"
    cp "$file" "$RES_DIR/$rel"
  done < <(find "$ICON_DIR" -type f -print0 2>/dev/null || true)
fi

# 清理 JNI 符号链接
JNI_DIR="$ANDROID_PROJECT_DIR/app/src/main/jniLibs"
if [ -d "$JNI_DIR" ]; then
  step "清理旧的 JNI 符号链接"
  find "$JNI_DIR" -type l -name '*.so' -print -delete 2>/dev/null || true
fi

# 构建 APK
npx tauri android build --debug --target aarch64 --apk

# 步骤 4: 查找并安装 APK
step "查找构建的 APK"
APK_PATH=$(find "$ANDROID_PROJECT_DIR/app/build/outputs/apk" -type f -name "*-debug.apk" -print 2>/dev/null | head -1)

if [ -z "$APK_PATH" ]; then
  fail "未找到构建的 APK 文件"
fi

echo "APK 文件: $APK_PATH"

# 步骤 5: 安装应用
step "安装应用到模拟器"
adb -s "$DEVICE_SERIAL" install -r "$APK_PATH"

# 步骤 6: 启动应用
step "启动应用"

# 获取包名
PACKAGE_NAME=$(grep -o 'applicationId = "[^"]*"' "$ANDROID_PROJECT_DIR/app/build.gradle.kts" | cut -d'"' -f2 || echo "com.miyako.app")

adb -s "$DEVICE_SERIAL" shell am force-stop "$PACKAGE_NAME" 2>/dev/null || true
adb -s "$DEVICE_SERIAL" shell am start -n "$PACKAGE_NAME/.MainActivity"

step "🎉 部署完成！"
echo ""
echo "应用已成功安装并启动！"
echo "设备: $DEVICE_SERIAL"
echo "包名: $PACKAGE_NAME"
echo ""
echo "你可以在模拟器中查看应用效果。"
echo "如需停止应用，运行: adb -s $DEVICE_SERIAL shell am force-stop $PACKAGE_NAME"
