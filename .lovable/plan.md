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

## Compilación y entrega de la APK
- Proyecto Android de Capacitor incluido en el repositorio (`android/`), JDK 17, Gradle, Android SDK 34/35.
- Scripts: `scripts/setup-ubuntu.sh` (instala JDK, SDK, Node), `scripts/build-debug.sh`, `scripts/build-release.sh`, `scripts/test.sh`, `scripts/verify-apk.sh` (apksigner + aapt).
- **GitHub Actions**: al publicar una etiqueta `v*`, compila Debug y Release firmada, ejecuta pruebas y publica ambas APK como GitHub Release con enlace de descarga. Firma con tu keystore guardado como secreto de GitHub (nunca en el repo).
- Opción equivalente: runner autoalojado de GitHub en tu VM Azure, para que la compilación ocurra allí.
- `ANDROID.md`, `CHANGELOG.md`, `.gitignore` que excluye keystores, `.env` y secretos; pruebas de aislamiento entre proyectos.

## Lo que necesito de ti (no puedo hacerlo yo desde aquí)
- **Conectar GitHub** desde Lovable (Conectores → GitHub): el código se sincroniza solo; yo no puedo crear el repositorio ni subirlo por mi cuenta.
- **Crear tu keystore de firma** (comando incluido en `ANDROID.md`) y añadirlo como secreto en GitHub.
- **Publicar la etiqueta `v0.1.0`** (o yo te dejo el flujo para lanzarlo con un botón en GitHub Actions).
- No tengo acceso a tu VM Azure ni a un emulador Android: no podré afirmar que la APK se instaló y abrió hasta que tú lo pruebes en tu teléfono o la compilación en Actions lo confirme. No declararé nada como compilado o probado sin evidencia real.

## Fuera de la Fase 1
Multiagentes, selección automática de modelo, imágenes/video/audio, investigación web, ejecución de código, documentos/presentaciones, conectores externos.

## Diseño
Oscuro y profesional, navegación inferior (Proyectos, Chats, Memoria, Ajustes), Space Grotesk + DM Sans, acento ámbar.
