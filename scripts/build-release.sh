#!/usr/bin/env bash
# Uso: KS=ruta.jks KS_PASS=... KEY_ALIAS=... KEY_PASS=... scripts/build-release.sh
set -euo pipefail
cd "$(dirname "$0")/.."
bun install
bash scripts/android-prepare.sh
(cd android && ./gradlew assembleRelease --no-daemon)
BT=$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)
"$BT/zipalign" -p -f 4 android/app/build/outputs/apk/release/app-release-unsigned.apk /tmp/aligned.apk
"$BT/apksigner" sign --ks "$KS" --ks-pass env:KS_PASS --ks-key-alias "$KEY_ALIAS" --key-pass env:KEY_PASS --out MI-AI-release.apk /tmp/aligned.apk
"$BT/apksigner" verify MI-AI-release.apk && echo "APK firmada: MI-AI-release.apk"
