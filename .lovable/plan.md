# MI AI Web: app instalable en Windows, Mac, iPhone, iPad y Android

## Qué tendrás
- Una dirección web de MI AI que se abre en cualquier navegador y se **instala como app** (icono propio, ventana sin barra del navegador):
  - Windows y Mac: Chrome o Edge, botón "Instalar".
  - iPhone y iPad: Safari, Compartir → "Añadir a pantalla de inicio".
  - Android: Chrome "Instalar app" (la APK sigue existiendo).
- **Cuenta con correo y contraseña**: tus proyectos, chats y modelos aparecen en todos tus equipos.
- **Nada descifrable en la nube**: todo se cifra en tu equipo con una clave derivada de tu contraseña antes de subir. Ni el servidor ni nosotros podemos leerlo. Si olvidas la contraseña, se ofrece una **clave de recuperación** impresa al registrarte; sin ella los datos no se recuperan.
- **Funciona sin internet**: la app abre y muestra tus proyectos guardados en ese equipo; al volver la conexión se sincroniza. Las respuestas de IA sí necesitan internet.

## Fases
1. **Instalable y sin conexión**: icono, nombre, colores grafito/violeta y modo sin conexión solo en la versión publicada (nunca en la vista previa).
2. **Cuentas**: registro, inicio de sesión, recuperación de contraseña y pantalla de clave de recuperación.
3. **Almacén web cifrado**: la misma base de datos de la app, guardada cifrada en el equipo para funcionar sin internet.
4. **Sincronización cifrada**: subida/bajada de cambios por proyecto, resolviendo conflictos (gana el cambio más reciente por registro, sin mezclar proyectos).
5. **Llamadas a proveedores desde la web**: Azure y otros bloquean llamadas directas desde navegadores; se usa un paso intermedio que solo reenvía la solicitud, sin guardar ni registrar tus claves.
6. **Ajustes por plataforma**: escritorio con barra lateral amplia, iPhone/iPad con márgenes seguros; funciones exclusivas de Android (Bluetooth, SSH nativo, compartir del sistema) se ocultan en web con aviso.
7. **Publicar** y probar instalación en Windows, Mac, iPhone y Android.

## Límites honestos
- Apps de **tienda** para iPhone/Mac (App Store) requieren compilar en una Mac con Xcode y cuenta de Apple; no se puede desde aquí. La versión instalable cubre iPhone/iPad sin tienda.
- iPhone puede borrar datos web locales tras semanas sin uso; la nube cifrada los restaura.
- Las cuentas permiten después montar suscripciones y niveles (siguiente proyecto).

## Detalles técnicos
- Cambia la regla "sin backend obligatorio" solo para la web: se activa Lovable Cloud (auth + tabla `encrypted_records` con `user_id, project_id, record_id, ciphertext, iv, updated_at, deleted`, RLS por `auth.uid()`, GRANTs). La APK sigue local-first; la sincronización será opcional allí. Actualizar AGENTS.md.
- Cifrado: Argon2id/PBKDF2 sobre contraseña → KEK; DEK aleatoria envuelta con KEK y con clave de recuperación; AES-GCM por registro (reutiliza formato de backups v3). Claves API van cifradas igual y nunca en logs.
- Almacenamiento web: sql.js persistido cifrado en OPFS/IndexedDB solo como contenedor de ciphertext, detrás del mismo `SqlDb`/`Repo`; pruebas de aislamiento existentes se extienden.
- PWA: `vite-plugin-pwa` generateSW, `injectRegister:null`, `devOptions.enabled:false`, wrapper con guardas de preview/iframe y `?sw=off`, NetworkFirst para navegación, excluir `/~oauth` y rutas `/api`.
- Proxy: ruta servidor sin estado que reenvía a hosts de proveedor permitidos (allowlist, sin redirecciones, sin logs de cabeceras); clave viaja por solicitud.
- Pruebas: cifrado/descifrado y contraseña errónea, aislamiento por usuario/proyecto en sync, guardas del service worker.
