#!/usr/bin/env bash
# Builds the UI, creates/syncs the native Capacitor Android project and applies MI AI settings.
# Env: VERSION_NAME (default from version.json), VERSION_CODE (default 1)
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION_NAME="${VERSION_NAME:-$(node -p "require('./version.json').version")}"
VERSION_CODE="${VERSION_CODE:-1}"

python3 scripts/fetch-pyodide-packages.py
CAPACITOR=1 npx vite build
test -f dist/client/index.html || { echo "dist/client/index.html missing"; exit 1; }

[ -d android ] || npx cap add android
npx cap sync android

# Android 11+ (API 30), compile/target 35.
sed -i -E 's/minSdkVersion = [0-9]+/minSdkVersion = 30/; s/compileSdkVersion = [0-9]+/compileSdkVersion = 35/; s/targetSdkVersion = [0-9]+/targetSdkVersion = 35/' android/variables.gradle

# Version from CI build number.
sed -i -E "s/versionCode [0-9]+/versionCode ${VERSION_CODE}/; s/versionName \"[^\"]*\"/versionName \"${VERSION_NAME}\"/" android/app/build.gradle

# Keep both ARM ABIs (Poco C40 = arm64; armv7 for 32-bit devices) plus x86_64 for the CI emulator.
if ! grep -q "abiFilters" android/app/build.gradle; then
  sed -i -E "s/(defaultConfig \{)/\1\n        ndk { abiFilters 'arm64-v8a', 'armeabi-v7a', 'x86_64' }/" android/app/build.gradle
fi

# Fixed Debug signing key (same certificate as build.5+), so every Debug APK can update the previous one.
if ! grep -q "miai-debug.keystore" android/app/build.gradle; then
  sed -i -E "s#(^android \{)#\1\n    signingConfigs { debug { storeFile file('../../signing/miai-debug.keystore'); storePassword 'android'; keyAlias 'androiddebugkey'; keyPassword 'android' } }#" android/app/build.gradle
fi

# No cloud backup of app data (encrypted DB stays on the device).
sed -i -E 's/android:allowBackup="true"/android:allowBackup="false"/' android/app/src/main/AndroidManifest.xml
# Microphone for dictation / voice notes (Capacitor's WebChromeClient asks the user at runtime).
grep -q RECORD_AUDIO android/app/src/main/AndroidManifest.xml || sed -i 's#<application#<uses-permission android:name="android.permission.RECORD_AUDIO" />\n    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />\n    <application#' android/app/src/main/AndroidManifest.xml

# Debug-only deep link used by the CI self-test (miai://selftest/...). Not present in release builds.
mkdir -p android/app/src/debug
cat > android/app/src/debug/AndroidManifest.xml <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools">
  <application>
    <activity android:name=".MainActivity" android:exported="true" tools:node="merge">
      <intent-filter>
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <category android:name="android.intent.category.BROWSABLE" />
        <data android:scheme="miai" android:host="selftest" />
      </intent-filter>
    </activity>
  </application>
</manifest>
XML

# MI AI native Keystore plugin (master keys inside Android Keystore, StrongBox when available).
JAVA_DIR=android/app/src/main/java/com/miai/app
mkdir -p "$JAVA_DIR"
cp scripts/native/MiaiKeystorePlugin.java "$JAVA_DIR/MiaiKeystorePlugin.java"
cp scripts/native/MiaiRemotePlugin.java "$JAVA_DIR/MiaiRemotePlugin.java"
cp scripts/native/MiaiSchedulePlugin.java "$JAVA_DIR/MiaiSchedulePlugin.java"
cp scripts/native/MiaiScheduleReceiver.java "$JAVA_DIR/MiaiScheduleReceiver.java"
cp scripts/native/MiaiMediaPlugin.java "$JAVA_DIR/MiaiMediaPlugin.java"
cp scripts/native/MiaiTunnelPlugin.java "$JAVA_DIR/MiaiTunnelPlugin.java"
cp scripts/native/MiaiVpnPlugin.java "$JAVA_DIR/MiaiVpnPlugin.java"
cp scripts/native/MiaiVpnService.java "$JAVA_DIR/MiaiVpnService.java"
cp scripts/native/MainActivity.java "$JAVA_DIR/MainActivity.java"
grep -q 'com.github.mwiede:jsch' android/app/build.gradle || printf '\ndependencies { implementation "com.github.mwiede:jsch:2.28.2" }\n' >> android/app/build.gradle
grep -q 'media3-transformer' android/app/build.gradle || printf '\ndependencies { implementation "androidx.media3:media3-transformer:1.5.1"; implementation "androidx.media3:media3-effect:1.5.1" }\n' >> android/app/build.gradle
# Package visibility for launching a separately installed Termux (no local shell bridge).
grep -q 'package android:name="com.termux"' android/app/src/main/AndroidManifest.xml || sed -i 's#<application#<queries><package android:name="com.termux" /></queries>\n    <application#' android/app/src/main/AndroidManifest.xml

# Inexact due-date reminders persist through process death and reboot; no background provider calls.
grep -q POST_NOTIFICATIONS android/app/src/main/AndroidManifest.xml || sed -i 's#<application#<uses-permission android:name="android.permission.POST_NOTIFICATIONS" /><uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />\n    <application#' android/app/src/main/AndroidManifest.xml
grep -q MiaiScheduleReceiver android/app/src/main/AndroidManifest.xml || sed -i 's#</application>#<receiver android:name=".MiaiScheduleReceiver" android:exported="false"><intent-filter><action android:name="android.intent.action.BOOT_COMPLETED" /><action android:name="android.intent.action.MY_PACKAGE_REPLACED" /></intent-filter></receiver>\n    </application>#' android/app/src/main/AndroidManifest.xml

echo "Android project ready: version ${VERSION_NAME} (${VERSION_CODE})"

# Split VPN toward the paired PC Node (user-started only, Android consent + foreground notice; never sticky).
M=android/app/src/main/AndroidManifest.xml
grep -q FOREGROUND_SERVICE_SPECIAL_USE $M || sed -i 's#<application#<uses-permission android:name="android.permission.FOREGROUND_SERVICE" /><uses-permission android:name="android.permission.FOREGROUND_SERVICE_SPECIAL_USE" />\n    <application#' $M
grep -q MiaiVpnService $M || sed -i 's#</application>#<service android:name=".MiaiVpnService" android:permission="android.permission.BIND_VPN_SERVICE" android:exported="false" android:foregroundServiceType="specialUse"><intent-filter><action android:name="android.net.VpnService" /></intent-filter><property android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE" android:value="vpn" /></service>\n    </application>#' $M
