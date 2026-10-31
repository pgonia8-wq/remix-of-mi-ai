#!/usr/bin/env bash
# Runs on an Android 11 (API 30) emulator: install, open, write data, restart, verify persistence,
# then checks SQLCipher encryption on the DB file and that the API key never reaches logcat/prefs.
set -uo pipefail
APK="${1:?apk}"
PKG=com.miai.app
OUT=emulator-report
mkdir -p "$OUT"
R="$OUT/report.md"
echo "# Informe emulador — $(date -u)  (API $(adb shell getprop ro.build.version.sdk | tr -d '\r'), ABI $(adb shell getprop ro.product.cpu.abi | tr -d '\r'))" > "$R"
fail=0
check() { if [ "$2" = 0 ]; then echo "- PASS $1" >> "$R"; else echo "- FAIL $1" >> "$R"; fail=1; fi; }

adb install -r "$APK"; check "Instalación del APK" $?
adb logcat -c
adb shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null; sleep 12
adb shell pidof $PKG >/dev/null; check "La app abre y sigue en ejecución" $?
adb exec-out screencap -p > "$OUT/1-abierta.png"

adb shell am start -W -a android.intent.action.VIEW -d "miai://selftest/write" $PKG >/dev/null; sleep 8
adb logcat -d | grep -q "MIAI_SELFTEST PASS write"; check "Crear proyectos, chat, mensaje y proveedor con API key" $?

adb shell am force-stop $PKG; sleep 2
adb logcat -c
adb shell am start -W -a android.intent.action.VIEW -d "miai://selftest/verify" $PKG >/dev/null; sleep 10
adb logcat -d > "$OUT/logcat-verify.txt"
grep -q "MIAI_SELFTEST PASS verify" "$OUT/logcat-verify.txt"; check "Persistencia tras cerrar y reabrir + aislamiento + descifrado de API key (Keystore)" $?
grep -q "MIAI_SELFTEST PASS verify encrypted-backup-restored-wrong-password-rejected" "$OUT/logcat-verify.txt"; check "Exportación cifrada, contraseña incorrecta rechazada y recuperación completa de registros del proyecto" $?
grep "MIAI_SELFTEST" "$OUT/logcat-verify.txt" >> "$R"
adb exec-out screencap -p > "$OUT/2-reabierta.png"

# SQLCipher: the DB file must not contain the plaintext probe nor the SQLite header.
DB=$(adb shell run-as $PKG find databases -name "miai*" | tr -d '\r' | grep -v -- "-journal\|-wal\|-shm" | head -1)
test -n "$DB"; check "Ruta de base de datos localizada" $?
adb exec-out run-as $PKG cat "$DB" > "$OUT/db.bin"
test -s "$OUT/db.bin"; check "Base de datos creada ($DB)" $?
! grep -aq "MIAI_PLAINTEXT_PROBE_7f3a" "$OUT/db.bin"; check "SQLCipher: el texto del chat no aparece legible en el archivo" $?
! head -c 16 "$OUT/db.bin" | grep -aq "SQLite format 3"; check "SQLCipher: el archivo no tiene cabecera SQLite en claro" $?
rm -f "$OUT/db.bin"

# API key never in DB, shared prefs, or logcat.
adb exec-out run-as $PKG sh -c 'cat databases/* shared_prefs/* 2>/dev/null' > /tmp/appdata.bin
! grep -aq "sk-MIAI-KEY-PROBE-9c2e" /tmp/appdata.bin; check "API key ausente en texto plano en base y preferencias" $?
adb logcat -d > /tmp/full.txt
! grep -q "sk-MIAI-KEY-PROBE-9c2e" /tmp/full.txt; check "API key ausente en logcat" $?

cat "$R"
exit $fail
