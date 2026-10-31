# MI AI — Android

## Arquitectura
- Interfaz: React + Vite (TanStack Start), prerenderizada a `dist/client/index.html` con `CAPACITOR=1`.
- Plataforma nativa: Capacitor 7 (`com.miai.app`). La carpeta `android/` se genera y sincroniza con `scripts/android-prepare.sh` (minSdk 30 = Android 11, target 35, ABIs arm64-v8a / armeabi-v7a / x86_64).
- Datos: SQLite nativo cifrado con SQLCipher (`@capacitor-community/sqlite`, `androidIsEncryption`). La clave de SQLCipher la guarda el plugin con protección de Android Keystore.
- API keys: cifradas con AES-256-GCM. La clave AES se guarda en `@aparajita/capacitor-secure-storage`, que usa Android Keystore. Las keys nunca se escriben en logs ni en las exportaciones.
- Documentos: almacenamiento privado de la app (`Directory.Data`), en `docs/<projectId>/…`.
- `allowBackup=false`. El enlace `miai://selftest` solo existe en la APK Debug (lo usa la prueba automática del emulador).
- Vista web de Lovable: sql.js + localStorage, **solo para desarrollo**.

Límite: el cifrado y Keystore reducen mucho el riesgo, pero en un teléfono comprometido (root o malware con privilegios) no se puede garantizar que las API keys sean inaccesibles.

## Entrega automática (GitHub Actions, `.github/workflows/android.yml`)
En cada push a `main`: pruebas unitarias → APK Debug + Release → verificación de ABIs y minSdk → emulador Android 11 → publicación.
- **Pruebas**: una sola pre-release `dev-latest` ("Última compilación de pruebas"), que se reemplaza en cada commit. Versión `X.Y.Z-build.N` (N = número de ejecución = versionCode).
- **Estable**: cuando subes `version.json` a una versión nueva, se crea la Release `vX.Y.Z` (una sola vez por versión).
- **Release firmada**: se publica sola cuando existen los secretos del repositorio `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.

Generar la clave de firma (una vez, en tu equipo):
```
keytool -genkeypair -v -keystore miai-release.jks -alias miai -keyalg RSA -keysize 4096 -validity 10000
base64 -w0 miai-release.jks   # pega el resultado en ANDROID_KEYSTORE_BASE64
```

## VM Ubuntu (opcional)
`scripts/setup-ubuntu.sh` → `scripts/build-debug.sh` / `scripts/build-release.sh` / `scripts/test.sh` / `scripts/verify-apk.sh`.
