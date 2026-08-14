#!/usr/bin/env bash
# Machine-checkable APK acceptance gate for miyako.
#
# Usage: scripts/verify-android-apk.sh <apk> [expected-application-id]
#
# Fails (exit 1) when:
#   - the APK is missing launcher icon resources (any density, adaptive XMLs)
#   - the application id / label does not match the expected miyako identity
#   - legacy identities (com.nasmusic.*, label NasMusicSync) are detected
#
# Uses aapt2/aapt/apkanalyzer from the Android SDK when available; otherwise
# falls back to binary AndroidManifest.xml string-pool inspection (strings -el).

set -euo pipefail

APK="${1:-}"
EXPECTED_ID="${2:-${EXPECTED_APPLICATION_ID:-com.miyako.app}}"
FORBIDDEN_STRINGS="com.nasmusic.test com.nasmusic.sync NasMusicSync"

fail() {
    echo "APK VERIFY FAIL: $1" >&2
    exit 1
}

[ -n "$APK" ] || fail "usage: $0 <apk> [expected-application-id]"
[ -f "$APK" ] || fail "APK not found: $APK"

echo "Verifying APK: $APK"
echo "Expected applicationId: $EXPECTED_ID"

unzip -t "$APK" > /dev/null 2>&1 || fail "not a valid zip/APK archive"

# ---------------------------------------------------------------- icons
icon_entries="$(unzip -l "$APK" 'res/mipmap-*/*' 2>/dev/null | awk '{print $4}' | grep -E 'ic_launcher' || true)"

for required in \
    "res/mipmap-anydpi-v26/ic_launcher.xml" \
    "res/mipmap-anydpi-v26/ic_launcher_round.xml"; do
    echo "$icon_entries" | grep -qx "$required" || fail "missing adaptive icon resource: $required"
done

density_pngs="$(echo "$icon_entries" | grep -E 'res/mipmap-(mdpi|hdpi|xhdpi|xxhdpi|xxxhdpi)(-v[0-9]+)?/' || true)"
density_count="$(echo "$density_pngs" | grep -c 'ic_launcher\.png' || true)"
[ "$density_count" -ge 1 ] || fail "no legacy ic_launcher.png found in any density bucket"
echo "$density_pngs" | grep -q 'ic_launcher_round\.png' || fail "no legacy ic_launcher_round.png found"
echo "$density_pngs" | grep -q 'ic_launcher_foreground\.png' || fail "no ic_launcher_foreground.png found"
echo "Icons OK: adaptive XMLs present, $density_count density PNG sets."

# ------------------------------------------------- aapt (exact) checks
find_aapt() {
    local search_dirs=("${ANDROID_HOME:-/nonexistent}/build-tools" "${ANDROID_SDK_ROOT:-/nonexistent}/build-tools")
    local d
    for d in "${search_dirs[@]}"; do
        [ -d "$d" ] || continue
        find "$d" -maxdepth 2 -type f \( -name aapt2 -o -name aapt \) 2>/dev/null | sort -V | tail -1
    done
}

AAPT="$(find_aapt | head -1 || true)"

manifest_pool() {
    unzip -p "$APK" AndroidManifest.xml 2>/dev/null | strings -el
}

if [ -n "$AAPT" ] && [ -x "$AAPT" ]; then
    echo "Using aapt: $AAPT"
    BADGING="$("$AAPT" dump badging "$APK" 2>/dev/null || true)"
    [ -n "$BADGING" ] || fail "aapt dump badging produced no output"

    ACTUAL_ID="$(echo "$BADGING" | sed -n "s/^package: name='\([^']*\)'.*/\1/p" | head -1)"
    LABEL="$(echo "$BADGING" | sed -n "s/^application-label:'\([^']*\)'.*/\1/p" | head -1)"
    LAUNCHABLE="$(echo "$BADGING" | sed -n "s/^launchable-activity: name='\([^']*\)'.*/\1/p" | head -1)"

    [ "$ACTUAL_ID" = "$EXPECTED_ID" ] || fail "applicationId is '$ACTUAL_ID', expected '$EXPECTED_ID'"
    [ -n "$LABEL" ] || fail "application-label missing from badging output"
    echo "applicationId: $ACTUAL_ID"
    echo "application-label: $LABEL"
    echo "launchable-activity: $LAUNCHABLE"
else
    echo "No aapt found; falling back to binary manifest string-pool checks."
    ACTUAL_ID="$(manifest_pool | grep -x "$EXPECTED_ID" | head -1 || true)"
    [ -n "$ACTUAL_ID" ] || fail "expected applicationId '$EXPECTED_ID' not found in AndroidManifest.xml string pool"
    echo "applicationId string '$ACTUAL_ID' found in manifest pool (exact label check skipped: no aapt)."
fi

# ------------------------------------------------- forbidden identities
for forbidden in $FORBIDDEN_STRINGS; do
    if manifest_pool | grep -qx "$forbidden"; then
        fail "forbidden legacy identity '$forbidden' found in AndroidManifest.xml"
    fi
done
echo "No forbidden legacy identities (com.nasmusic.*, NasMusicSync) present."

echo "APK VERIFY OK"
