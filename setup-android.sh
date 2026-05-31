#!/bin/bash
# Android 开发环境自动设置脚本
# 用于将 Tauri 应用编译并安装到 Android 手机

set -e

echo "📱 NasMusicSync Android 环境设置"
echo "=================================="

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_ok() { echo -e "${GREEN}✅ $1${NC}"; }
print_warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
print_err() { echo -e "${RED}❌ $1${NC}"; }
print_step() { echo -e "\n${GREEN}▶ $1${NC}"; }

# ============================================
# Step 1: 检查并安装 Homebrew
# ============================================
print_step "Step 1: 检查 Homebrew"
if command -v brew &>/dev/null; then
    print_ok "Homebrew 已安装"
else
    print_warn "正在安装 Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    print_ok "Homebrew 安装完成"
fi

# ============================================
# Step 2: 检查并安装 JDK 17
# ============================================
print_step "Step 2: 检查 JDK 17"
if /opt/homebrew/opt/openjdk@17/bin/java -version &>/dev/null 2>&1; then
    print_ok "JDK 17 已安装"
else
    print_warn "正在安装 JDK 17..."
    brew install openjdk@17
    print_ok "JDK 17 安装完成"
fi

export JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
export PATH="/opt/homebrew/opt/openjdk@17/bin:$PATH"
print_ok "JAVA_HOME=$JAVA_HOME"

# ============================================
# Step 3: 检查并安装 Android Studio
# ============================================
print_step "Step 3: 检查 Android Studio"
if [ -d "/Applications/Android Studio.app" ]; then
    print_ok "Android Studio 已安装"
else
    print_warn "正在安装 Android Studio (可能需要几分钟)..."
    brew install --cask android-studio
    print_ok "Android Studio 安装完成"
    print_warn "请打开 Android Studio 完成初始设置，然后重新运行此脚本"
    echo "       或者继续，我会尝试自动设置 SDK"
fi

# ============================================
# Step 4: 设置 Android SDK
# ============================================
print_step "Step 4: 设置 Android SDK"

export ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"

mkdir -p "$ANDROID_HOME"

# 检查 SDK 是否存在
if [ -d "$ANDROID_HOME/platforms" ]; then
    print_ok "Android SDK 已配置"
else
    print_warn "正在下载 Android SDK 命令行工具..."

    # 下载 cmdline-tools
    CMDLINE_TOOLS_URL="https://dl.google.com/android/repository/commandlinetools-mac-11076708_latest.zip"
    TEMP_DIR=$(mktemp -d)

    curl -sL "$CMDLINE_TOOLS_URL" -o "$TEMP_DIR/cmdline-tools.zip"
    unzip -q "$TEMP_DIR/cmdline-tools.zip" -d "$TEMP_DIR"

    mkdir -p "$ANDROID_HOME/cmdline-tools"
    mv "$TEMP_DIR/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"

    rm -rf "$TEMP_DIR"
    print_ok "SDK 命令行工具下载完成"

    # 安装必要的 SDK 组件
    print_warn "正在安装 SDK 组件..."
    yes | sdkmanager --sdk_root="$ANDROID_HOME" --licenses > /dev/null 2>&1 || true
    sdkmanager --sdk_root="$ANDROID_HOME" "platform-tools" "platforms;android-33" "build-tools;33.0.2" 2>&1 | tail -5
    print_ok "SDK 组件安装完成"
fi

# ============================================
# Step 5: 检查设备连接
# ============================================
print_step "Step 5: 检查设备连接"
adb devices 2>&1 | grep -v "List of devices" | grep -v "^$"

DEVICE_COUNT=$(adb devices | grep -v "List of devices" | grep -v "^$" | grep "device$" | wc -l)
if [ "$DEVICE_COUNT" -gt 0 ]; then
    print_ok "检测到 $DEVICE_COUNT 个设备"
else
    print_warn "未检测到设备"
    echo "       请确保："
    echo "       1. 手机已通过 USB 连接"
    echo "       2. 已开启 USB 调试"
    echo "       3. 已在手机上点击'允许调试'"
fi

# ============================================
# Step 6: 设置环境变量（持久化）
# ============================================
print_step "Step 6: 保存环境变量"
SHELL_RC="$HOME/.zshrc"

# 检查是否已设置
if grep -q "ANDROID_HOME" "$SHELL_RC" 2>/dev/null; then
    print_ok "环境变量已配置"
else
    cat >> "$SHELL_RC" << 'EOF'

# Android SDK
export ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"

# Java JDK 17
export JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
export PATH="/opt/homebrew/opt/openjdk@17/bin:$PATH"
EOF
    print_ok "环境变量已添加到 $SHELL_RC"
fi

# ============================================
# Step 7: 初始化 Tauri Android 项目
# ============================================
print_step "Step 7: 初始化 Tauri Android 项目"
cd /Users/tetsuya/Development/music

if [ -d "src-tauri/gen/android" ]; then
    print_ok "Android 项目已初始化"
else
    print_warn "正在初始化 Android 项目..."
    npm run tauri android init 2>&1
    print_ok "Android 项目初始化完成"
fi

# ============================================
# 完成
# ============================================
echo ""
echo "=================================="
print_ok "环境设置完成！"
echo ""
echo "下一步："
echo "  1. 确保手机已连接并开启 USB 调试"
echo "  2. 运行: cd ~/Development/music && npm run tauri android dev"
echo ""
echo "如果遇到问题，运行: adb devices 检查设备连接状态"
echo "=================================="
