# MI AI — Fase 1 (corregida): Android-first, SQLite/SQLCipher nativo

## Funciones de la Fase 1
1. **Proyectos aislados**: chats, memoria y documentos por proyecto. Los chats del mismo proyecto comparten conocimiento; ningún proyecto ve otro.
2. **Conexiones de proveedores**: OpenAI, Anthropic, Gemini, Azure AI Foundry, xAI, DeepSeek, Mistral, Cohere, compatible OpenAI y endpoint personalizado. Campos: nombre, endpoint, API key, deployment, modelo, versión, parámetros extra. Añadir, editar, probar, desactivar, eliminar sin reinstalar.
3. **Chat con streaming**, cambio de modelo a mitad de conversación sin perder historial ni contexto.
4. **Memoria por proyecto**: hechos, decisiones, hipótesis; editable y versionada; nunca borra conversaciones originales.
5. **Documentos del proyecto** guardados en el almacenamiento privado de Android, con búsqueda local.
6. **Funciona sin Internet** para consultar todo; solo las respuestas de IA requieren conexión.
7. **Exportar/importar** cifrado con contraseña.

## Almacenamiento (definitivo desde el inicio)
- SQLite nativo con cifrado SQLCipher (plugin `@capacitor-community/sqlite`, modo cifrado).
- Clave de la base de datos y API keys protegidas con Android Keystore (plugin de almacenamiento seguro).
- Archivos binarios en el almacenamiento privado de la app (`@capacitor/filesystem`), enlazados por ID al proyecto.
- Sin IndexedDB/Dexie como base, sin Supabase/Firebase ni base remota.
- Capa de repositorios abstracta; cada operación exige `projectId` y valida aislamiento.
- La vista previa de Lovable usa el modo web del mismo plugin (SQLite en WASM) solo para poder ver la interfaz mientras desarrollamos; no es el almacenamiento del producto.

## Tres entornos
- **Lovable**: desarrollo del código.
- **GitHub**: repositorio, versiones y Releases con la APK.
- **Azure VM (Ubuntu)**: compilación reproducible y pruebas.

## Compilación y entrega de la APK (automática, sin pasos manuales tuyos)
- Proyecto Android de Capacitor en el repositorio (`android/`), JDK 17, Gradle, SDK 34/35, **minSdk 30 (Android 11+)**, compatible con Poco C40 (arm64/armv7).
- **GitHub Actions se ejecuta solo en cada sincronización a `main`**: compila, prueba y publica automáticamente una GitHub Release con ambas APK y versión autoincrementada. No necesitas crear etiquetas ni pulsar nada.
- Pruebas automáticas en Actions con un emulador Android 11 (API 30): instalación, apertura, crear proyecto/chat, cerrar y reabrir para comprobar persistencia.
- **Debug** siempre se publica. **Release firmada** se publica en cuanto exista tu clave de firma como secreto de GitHub.
- Intento adicional: compilar también la APK Debug aquí en mi entorno y darte un enlace directo; si mis recursos no lo permiten, el enlace será el de la GitHub Release.
- Scripts para tu VM Azure Ubuntu (`setup-ubuntu.sh`, `build-debug.sh`, `build-release.sh`, `test.sh`, `verify-apk.sh`) y `ANDROID.md`, como entorno reproducible alternativo.

## Pruebas verificables
- **SQLCipher**: prueba que crea la base cifrada, la abre con la clave correcta y comprueba que sin clave o con clave incorrecta falla, y que el archivo no contiene texto legible.
- **API keys / Keystore**: prueba que la clave se guarda solo cifrada vía Keystore, que no aparece en la base, en preferencias, en logcat ni en las copias exportadas.
- **Aislamiento**: pruebas que intentan leer chats, documentos y memoria de otro proyecto por consulta directa, búsqueda de texto y contexto inyectado al modelo; todas deben devolver vacío o error.
- Informe final con tres columnas separadas: compilado / probado en emulador / pendiente de tu teléfono físico.

## Intervención tuya, solo lo indispensable
1. **Conectar GitHub** en Lovable (Conectores → GitHub): es un permiso que solo tú puedes dar; después todo se sincroniza solo.
2. **Clave de firma Release**: te daré un comando de un solo paso para generarla en tu equipo y la subes como secreto del repositorio. Nunca entra en el código.
- No tengo acceso a tu VM Azure ni a tu teléfono: lo que dependa de ellos lo marcaré como pendiente, sin simular resultados.

## Fuera de la Fase 1
Multiagentes, selección automática de modelo, imágenes/video/audio, investigación web, ejecución de código, documentos/presentaciones, conectores externos.

## Diseño
Oscuro y profesional, navegación inferior (Proyectos, Chats, Memoria, Ajustes), Space Grotesk + DM Sans, acento ámbar.
