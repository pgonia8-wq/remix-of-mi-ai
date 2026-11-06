#!/usr/bin/env bash
# Run once with ANDROID_KEYSTORE_PASSWORD supplied through a secure environment.
# Private outputs must stay outside the repository.
set -euo pipefail
set +x
umask 077
: "${ANDROID_KEYSTORE_PASSWORD:?Falta la contraseña de firma en el entorno seguro}"
OUT="${1:?Indica una carpeta privada fuera del repositorio}"
ROOT="$(realpath "$(dirname "$0")/..")"
mkdir -p "$OUT"
OUT="$(realpath "$OUT")"
case "$OUT/" in "$ROOT/"*) echo "La clave privada no se genera dentro del repositorio." >&2; exit 1;; esac
KS="$OUT/MI-AI-play-upload.jks"
if [ -e "$KS" ]; then echo "La clave ya existe; no se reemplaza." >&2; exit 1; fi
keytool -genkeypair -keystore "$KS" -storetype JKS \
  -alias miai-upload -keyalg RSA -keysize 4096 -sigalg SHA256withRSA \
  -validity 10000 -storepass:env ANDROID_KEYSTORE_PASSWORD \
  -keypass:env ANDROID_KEYSTORE_PASSWORD \
  -dname "CN=MI AI Upload, O=Trama Network" -noprompt
keytool -exportcert -rfc -keystore "$KS" -alias miai-upload \
  -storepass:env ANDROID_KEYSTORE_PASSWORD -file "$OUT/MI-AI-play-upload-certificate.pem"
keytool -list -keystore "$KS" -alias miai-upload \
  -storepass:env ANDROID_KEYSTORE_PASSWORD >/dev/null
echo "Clave de carga y certificado público generados y comprobados."