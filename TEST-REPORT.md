# MI AI Fase 1 — Informe de pruebas (31-oct-2026, compilación 0.1.0-build.2)

## Actualización: Azure OpenAI — 31-oct-2026
- **Corrección Azure v1 (19:49 UTC):** rechazo reproducido y corregido para la URL `https://pgonia8-4510-resource.services.ai.azure.com/openai/v1/chat/completions`. Ambos proveedores Azure reconocen `/openai/v1` y la URL completa; v1 envía deployment como `model` en el cuerpo, sin ruta legacy ni versión fechada. La versión puede dejarse vacía para v1; sigue siendo requerida para Azure OpenAI legacy.
- **Verificación v1:** 47/47 pruebas automáticas PASS, incluidas cinco regresiones que fallaban antes. En Chromium se envió una solicitud real a la URL exacta con una clave ficticia inválida: Azure devolvió HTTP 401 y se mostró el diagnóstico de API Key inválida, no rechazo de URL; guardado bloqueado y cero errores JavaScript. No se probó generación con una clave válida ni Android.
- **Programado:** proveedor Azure OpenAI separado, con únicamente URL, API Key, deployment y versión; nombre/modelo internos derivados del deployment, sin pedir JSON. Solicitud con `api-key`: deployment en ruta y versión en query para legacy; deployment como `model` en cuerpo para v1. Admite URL del recurso, URL completa de deployment y `/openai/v1/chat/completions`; los campos explícitos de deployment/versión prevalecen en legacy. Las llamadas siguen en el dispositivo.
- **Causa posible identificada, no confirmada para la solicitud del usuario:** antes se rechazaban URLs con `?api-version` y se duplicaba la ruta al pegar una URL completa. No se dispone de la URL ni de la respuesta HTTP de su intento para establecer su causa exacta.
- **Probado en Chromium, 1280×1800 y 360×627:** cuatro campos, ausencia de modelo/JSON, diagnóstico de credencial faltante, guardado bloqueado, sin errores JavaScript ni desbordamiento horizontal.
- **Pruebas unitarias:** solicitudes con URL raíz/completa, campos obligatorios, encabezados, cuerpo sin modelo/JSON, errores de red y persistencia/restauración sin claves; respuestas controladas solo en pruebas, nunca para simular éxito en la app.
- **Pendiente:** respuesta real de Azure con credenciales autorizadas; compilación de esta actualización; emulador Android y Poco C40. Sin respuesta HTTP no se puede distinguir CORS, red o restricciones del recurso. El APK anterior no incluye Azure OpenAI.

## Actualización: chat y validación de modelos — 31-oct-2026
- Causa confirmada del fallo de la vista previa: sql.js selecciona `sql-wasm-browser.js` y solicita `/wasm/sql-wasm-browser.wasm`; solo existía el archivo `sql-wasm.wasm`. Las peticiones devolvían 404 y la inicialización abortaba. No se encontró evidencia de un fallo de montaje o de registro de la ruta del chat. Se añadió el binario browser exacto de la dependencia y una prueba de regresión.
- **Programado:** Probar conexión en formulario; Guardar modelo solo tras respuesta real válida; invalidación al cambiar campos; solicitudes específicas por proveedor; timeout 20 s; diagnóstico sanitizado; estados persistentes, repetición de pruebas y actualización del estado tras fallos en chat. Las credenciales de borrador no se escriben en almacenamiento.
- **Probado en navegador Chromium:** creación de proyecto, entrada a chat nuevo, reapertura mediante recarga del chat existente, sin errores JavaScript; formulario con guardado bloqueado, dirección mal formada, endpoint real que devuelve 404 y fallo real de red. Verificado en 360×627 y 1280×1800, sin desbordamiento horizontal en el formulario.
- **Pruebas automáticas:** 32/32 PASS en Vitest/sql.js: 21 contratos de proveedores y diagnóstico, 8 repositorio/cifrado/aislamiento/estado, 2 rutas, 1 archivo WebAssembly. Los contratos de proveedores usan respuestas controladas exclusivamente como pruebas unitarias; NO acreditan conexiones reales exitosas.
- **Pendiente con proveedores reales:** credencial válida y generación efectiva; API Key incorrecta contra proveedor real; modelo inexistente contra proveedor real; timeout de proveedor real. No había credenciales autorizadas disponibles. No se simuló una conexión exitosa en la aplicación.
- **Android:** esta actualización no se ha compilado ni ejecutado en emulador o dispositivo físico. El APK build.2 anterior NO contiene estos cambios. El fallo WebAssembly pertenece a la rama web; Android usa SQLCipher y no depende de ese archivo. La validación de proveedores sí se comparte con Android y requiere comprobarse allí. No se modificaron SQLCipher, Keystore ni la configuración de seguridad nativa.

El resto del informe corresponde a la compilación anterior y no acredita estas mejoras.

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
