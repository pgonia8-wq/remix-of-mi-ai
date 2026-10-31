#!/usr/bin/env bash
# One-time setup on Ubuntu 22.04/24.04 (e.g. Azure VM): JDK 21, Node 22, Bun, Android SDK 35.
set -euo pipefail
sudo apt-get update
sudo apt-get install -y openjdk-21-jdk-headless unzip curl git
command -v node >/dev/null || { curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -; sudo apt-get install -y nodejs; }
command -v bun >/dev/null || curl -fsSL https://bun.sh/install | bash
export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
mkdir -p "$ANDROID_HOME/cmdline-tools"
if [ ! -d "$ANDROID_HOME/cmdline-tools/latest" ]; then
  curl -fsSL -o /tmp/cmd.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
  unzip -q /tmp/cmd.zip -d /tmp/cmd && mv /tmp/cmd/cmdline-tools "$ANDROID_HOME/cmdline-tools/latest"
fi
yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --licenses >/dev/null
"$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" "platform-tools" "platforms;android-35" "build-tools;35.0.0" "emulator" "system-images;android-30;google_apis;x86_64"
echo "export ANDROID_HOME=$ANDROID_HOME" >> ~/.bashrc
echo "Listo. Abre una terminal nueva."
