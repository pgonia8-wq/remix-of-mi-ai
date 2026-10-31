#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
bun install
bash scripts/android-prepare.sh
(cd android && ./gradlew assembleDebug --no-daemon)
bash scripts/verify-apk.sh android/app/build/outputs/apk/debug/app-debug.apk
echo "APK: android/app/build/outputs/apk/debug/app-debug.apk"
