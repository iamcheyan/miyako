#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_PROJECT_DIR="$ROOT_DIR/src-tauri/gen/android"
APK_OUTPUT_DIR="$ANDROID_PROJECT_DIR/app/build/outputs/apk"
BUILD_MODE="${BUILD_MODE:-debug}"
DEVICE_SERIAL="${DEVICE_SERIAL:-}"

export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
if [ ! -d "${ANDROID_HOME:-}" ]; then
  export ANDROID_HOME="$HOME/Library/Android/sdk"
fi
if [ ! -d "${ANDROID_SDK_ROOT:-}" ]; then
  export ANDROID_SDK_ROOT="$ANDROID_HOME"
fi
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$ROOT_DIR/src-tauri/gen/android/.gradle-home}"

step() {
  printf '\n==> %s\n' "$1"
}

fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

command -v npm >/dev/null || fail "npm not found"
command -v adb >/dev/null || fail "adb not found. Check Android SDK platform-tools."
[ -x "$JAVA_HOME/bin/java" ] || fail "JDK not found at JAVA_HOME=$JAVA_HOME"
[ -d "$ANDROID_PROJECT_DIR" ] || fail "Missing Tauri Android project. Run: npx tauri android init --ci"

adb_cmd() {
  if [ -n "$DEVICE_SERIAL" ]; then
    adb -s "$DEVICE_SERIAL" "$@"
  else
    adb "$@"
  fi
}

read_application_id() {
  local gradle_file="$ANDROID_PROJECT_DIR/app/build.gradle.kts"
  if [ -f "$gradle_file" ]; then
    sed -n 's/^[[:space:]]*applicationId[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$gradle_file" | head -1
  fi
}

read_tauri_identifier() {
  local config_file="$ROOT_DIR/src-tauri/tauri.conf.json"
  if [ -f "$config_file" ]; then
    sed -n 's/^[[:space:]]*"identifier"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$config_file" | head -1
  fi
}

package_path() {
  printf '%s' "$1" | tr '.' '/'
}

read_generated_package() {
  local main_activity
  main_activity="$(find "$ANDROID_PROJECT_DIR/app/src/main/java" -type f -name MainActivity.kt -print 2>/dev/null | head -1 || true)"
  if [ -n "$main_activity" ]; then
    sed -n 's/^package[[:space:]]\{1,\}\(.*\)$/\1/p' "$main_activity" | head -1
  fi
}

sync_generated_android_package() {
  local expected_package="$1"
  local current_package
  current_package="$(read_generated_package)"

  [ -n "$expected_package" ] || return 0
  [ -n "$current_package" ] || return 0
  [ "$current_package" != "$expected_package" ] || return 0

  local java_root="$ANDROID_PROJECT_DIR/app/src/main/java"
  local current_dir="$java_root/$(package_path "$current_package")"
  local expected_dir="$java_root/$(package_path "$expected_package")"

  step "Syncing generated Android package"
  printf 'Generated package: %s -> %s\n' "$current_package" "$expected_package"

  mkdir -p "$(dirname "$expected_dir")"
  if [ -d "$current_dir" ] && [ ! -e "$expected_dir" ]; then
    mv "$current_dir" "$expected_dir"
  fi

  while IFS= read -r -d '' file; do
    OLD_PACKAGE="$current_package" NEW_PACKAGE="$expected_package" perl -0pi -e 's/\Q$ENV{OLD_PACKAGE}\E/$ENV{NEW_PACKAGE}/g' "$file"
  done < <(
    find "$ANDROID_PROJECT_DIR/app" -type f \( \
      -name '*.kt' -o \
      -name '*.kts' -o \
      -name '*.pro' -o \
      -name '*.xml' -o \
      -name '*.json' \
    \) -print0
  )
}

clean_generated_jni_symlinks() {
  local jni_dir="$ANDROID_PROJECT_DIR/app/src/main/jniLibs"
  [ -d "$jni_dir" ] || return 0

  step "Cleaning generated JNI symlinks"
  find "$jni_dir" -type l -name '*.so' -print -delete
}

target_for_abi() {
  case "$1" in
    arm64-v8a) printf 'aarch64' ;;
    armeabi-v7a) printf 'armv7' ;;
    x86) printf 'i686' ;;
    x86_64) printf 'x86_64' ;;
    *) return 1 ;;
  esac
}

arch_for_abi() {
  case "$1" in
    arm64-v8a) printf 'arm64' ;;
    armeabi-v7a) printf 'arm' ;;
    x86) printf 'x86' ;;
    x86_64) printf 'x86_64' ;;
    *) return 1 ;;
  esac
}

apk_contains_abi() {
  local apk="$1"
  local abi="$2"
  unzip -l "$apk" "lib/$abi/*.so" >/dev/null 2>&1
}

verify_apk() {
  local apk="$1"
  local apksigner=""
  apksigner="$(find "$ANDROID_HOME/build-tools" -maxdepth 2 -type f -name apksigner | sort -V | tail -1 || true)"
  if [ -n "$apksigner" ]; then
    "$apksigner" verify "$apk" >/dev/null
  fi
}

find_built_apk() {
  local abi="$1"
  local arch="$2"
  local mode="$3"
  local mode_cap="${mode:0:1}"
  mode_cap="$(printf '%s%s' "$(printf '%s' "$mode_cap" | tr '[:lower:]' '[:upper:]')" "${mode:1}")"

  local candidates=(
    "$APK_OUTPUT_DIR/$arch/$mode/app-$arch-$mode.apk"
    "$APK_OUTPUT_DIR/universal/$mode/app-universal-$mode.apk"
  )

  local apk
  for apk in "${candidates[@]}"; do
    if [ -f "$apk" ] && apk_contains_abi "$apk" "$abi" && verify_apk "$apk"; then
      printf '%s\n' "$apk"
      return 0
    fi
  done

  while IFS= read -r apk; do
    if apk_contains_abi "$apk" "$abi" && verify_apk "$apk"; then
      printf '%s\n' "$apk"
      return 0
    fi
  done < <(find "$APK_OUTPUT_DIR" -type f -name "*-$mode.apk" -print 2>/dev/null | sort -r)

  fail "No signed $mode APK containing ABI $abi was found under $APK_OUTPUT_DIR"
}

step "Checking connected Android device"
adb_cmd devices -l
DEVICE_COUNT="$(adb_cmd devices | awk 'NR > 1 && $2 == "device" { count++ } END { print count + 0 }')"
if [ "$DEVICE_COUNT" -lt 1 ]; then
  fail "No authorized Android device found. Connect USB, enable USB debugging, and allow the prompt on the phone."
fi
if [ "$DEVICE_COUNT" -gt 1 ] && [ -z "$DEVICE_SERIAL" ]; then
  fail "Multiple devices found. Set DEVICE_SERIAL to choose one."
fi

DEVICE_ABI="$(adb_cmd shell getprop ro.product.cpu.abi | tr -d '\r')"
TAURI_TARGET="${TAURI_TARGET:-$(target_for_abi "$DEVICE_ABI")}" || fail "Unsupported Android ABI: $DEVICE_ABI"
ANDROID_ARCH="$(arch_for_abi "$DEVICE_ABI")" || fail "Unsupported Android ABI: $DEVICE_ABI"
TAURI_IDENTIFIER="$(read_tauri_identifier)"
sync_generated_android_package "$TAURI_IDENTIFIER"
PACKAGE_NAME="${PACKAGE_NAME:-$(read_application_id)}"
[ -n "$PACKAGE_NAME" ] || fail "Could not determine Android applicationId. Set PACKAGE_NAME manually."
MAIN_ACTIVITY="${MAIN_ACTIVITY:-$PACKAGE_NAME/.MainActivity}"

printf 'Device ABI: %s\n' "$DEVICE_ABI"
printf 'Tauri target: %s\n' "$TAURI_TARGET"
printf 'Package: %s\n' "$PACKAGE_NAME"

step "Building Tauri Android APK"
cd "$ROOT_DIR"
clean_generated_jni_symlinks
if [ "$BUILD_MODE" = "debug" ]; then
  npx tauri android build --debug --target "$TAURI_TARGET" --apk
else
  npx tauri android build --target "$TAURI_TARGET" --apk
fi

APK_PATH="$(find_built_apk "$DEVICE_ABI" "$ANDROID_ARCH" "$BUILD_MODE")"
printf 'APK: %s\n' "$APK_PATH"

step "Installing APK"
adb_cmd install -r "$APK_PATH"

step "Starting app"
adb_cmd shell am force-stop "$PACKAGE_NAME" || true
adb_cmd shell am start -n "$MAIN_ACTIVITY"

step "Done"
printf 'Installed and started %s\n' "$MAIN_ACTIVITY"
