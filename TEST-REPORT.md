# MI AI Fase 1 — Informe de pruebas (31-oct-2026, compilación 0.1.0-build.2)

## 1. Compilación realizada (entorno de Lovable, Linux, JDK 21, Android SDK 35)
| Elemento | Resultado |
|---|---|
| Interfaz prerenderizada para el APK | OK |
| Proyecto Android Capacitor generado y sincronizado (4 plugins nativos) | OK |
| `assembleDebug` → app-debug.apk (28 MB) | OK |
| `assembleRelease` → app-release-unsigned.apk (sin firma, falta tu clave) | OK |
| libsqlcipher.so en arm64-v8a y armeabi-v7a | OK |
| minSdkVersion 30 (Android 11) / target 35 | OK |
| allowBackup=false; enlace de autoprueba solo en Debug | OK |

## 2. Pruebas automáticas superadas — entorno: Node/Vitest con sql.js (misma lógica y SQL que en Android, sin SQLCipher)
| Prueba | Resultado |
|---|---|
| Aislamiento: chats, mensajes, memoria, documentos, búsqueda y contexto enviado a la IA de otro proyecto → vacío | PASS |
| Escribir en un chat de otro proyecto → error | PASS |
| Chats del mismo proyecto comparten memoria | PASS |
| Memoria versionada sin tocar las conversaciones | PASS |
| API key cifrada en la base, recuperable y ausente en la exportación | PASS |
| Exportación cifrada: contraseña incorrecta rechazada, sin texto legible | PASS |
| Exportar/importar un proyecto completo (chats, memoria con versiones, documentos) | PASS |

Vista previa web (navegador, 360 px): crear proyecto → chat → memoria → recargar → los datos siguen ahí. PASS.

## 3. Pruebas en emulador Android 11 — PENDIENTES (se ejecutan en GitHub Actions)
Este entorno no tiene virtualización (KVM), así que aquí no puede arrancar un emulador. `scripts/emulator-test.sh` corre en GitHub Actions en cada push y comprueba: instalación, apertura, creación de datos, persistencia tras cerrar y reabrir, aislamiento, descifrado de la API key vía Keystore, archivo de base cifrado (sin texto ni cabecera SQLite) y que la API key no aparece en la base, preferencias ni logcat. Se ejecuta en cuanto conectes GitHub; el informe queda como artefacto de cada ejecución.

## 4. Pendiente en tu Poco C40 (ARM64, físico)
- Instalar el APK y abrir la app.
- Crear proyecto, chat y memoria; cerrar la app y volver a abrirla.
- Añadir un proveedor real, probarlo y conversar con streaming; cambiar de modelo a mitad del chat.
- Subir un documento y buscarlo; usarlo sin Internet.
- Exportar una copia, borrar el proyecto e importarla.
- ARMv7 en ejecución real: no hay dispositivo de 32 bits disponible; solo se verifica que la librería está incluida.
