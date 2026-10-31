#!/usr/bin/env bash
# Verifies an APK contains native SQLCipher for arm64-v8a and armeabi-v7a and targets Android 11+.
set -euo pipefail
APK="${1:?uso: verify-apk.sh ruta.apk}"
LIST=$(unzip -l "$APK")
fail=0
for abi in arm64-v8a armeabi-v7a; do
  if echo "$LIST" | grep -q "lib/$abi/libsqlcipher.so"; then echo "OK  $abi: libsqlcipher.so"; else echo "FALTA $abi: libsqlcipher.so"; fail=1; fi
done
BT=$(ls -d "${ANDROID_HOME:-$ANDROID_SDK_ROOT}"/build-tools/* | sort -V | tail -1)
MIN=$("$BT/aapt2" dump badging "$APK" | sed -n "s/^minSdkVersion:'\([0-9]*\)'.*/\1/p")
echo "minSdkVersion=$MIN"
[ "$MIN" = "30" ] || { echo "minSdk debe ser 30 (Android 11)"; fail=1; }
"$BT/aapt2" dump badging "$APK" | grep -E "^package:|native-code" || true
exit $fail
