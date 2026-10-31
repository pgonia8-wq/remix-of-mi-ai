#!/usr/bin/env bash
# Unit tests + emulator tests (needs KVM and the API 30 system image from setup-ubuntu.sh).
set -euo pipefail
cd "$(dirname "$0")/.."
bunx vitest run
bash scripts/build-debug.sh
if ! adb get-state >/dev/null 2>&1; then
  echo no | "$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" create avd -n miai30 -k "system-images;android-30;google_apis;x86_64" --force
  "$ANDROID_HOME/emulator/emulator" -avd miai30 -no-window -no-audio -no-boot-anim &
  adb wait-for-device; until [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = 1 ]; do sleep 3; done
fi
bash scripts/emulator-test.sh android/app/build/outputs/apk/debug/app-debug.apk
