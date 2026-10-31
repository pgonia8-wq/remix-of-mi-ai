# MI AI, Etapa 1: Núcleo universal (especificación definitiva)

Este plan amplía lo que ya existe; no lo reescribe. Cada operación de cada proveedor se reporta por separado como: Diseñada, Programada, Integrada, Probada en web, Probada en Android o Probada en dispositivo físico.

## 1. Arquitectura existente que se conserva
| Pieza | Decisión |
|---|---|
| Proyectos, chats y memoria aislados (Repo con `projectId`) | Conservar |
| Repo | Conservar y ampliar |
| SQLCipher en Android, sql.js en la vista web | Conservar; solo se agregan tablas |
| Android Keystore y cifrado AES-GCM de las API Keys | Conservar; se amplía con la jerarquía de llaves para archivos |
| Proveedores de texto y Azure OpenAI | Se envuelven como adaptadores; su comportamiento no cambia (lo cubren pruebas de regresión) |
| Respaldo y restauración cifrados | Ampliar |
| Capacitor, APK automática y `android-prepare.sh` | Conservar; solo se agrega lo necesario |

Antes de tocar cada pieza se revisa su código, y el informe dice si se reutilizó, se amplió o se corrigió.

## 2. Arquitectura nueva
```text
INTERFAZ  (Modelos · Chat · Biblioteca · Trabajos)   <- sin lógica de proveedores
   |
UNIVERSAL AI CORE
   Registry (fuente central) -> Capability Engine -> Model Router -> Job Manager
   |
PROVIDER ADAPTERS            PERSISTENCIA
(texto · imagen · audio)     Repo (SQLCipher) + Asset Store cifrado + Workflow Data Layer
   |
APIs oficiales, endpoints compatibles y futuros modelos locales
```
- **Capacidades como datos:** `CapabilitySpec` con identificador, entradas y salidas, tipos de archivo, formatos, parámetros, límites, restricciones, tamaños máximos, si es síncrona o asíncrona, y si permite cancelar, consultar estado y recuperar resultados, además de la autenticación que requiere. Se cargan las 21 capacidades iniciales. Agregar una nueva no cambia la base de datos.
- **Adaptadores:** contrato `{ supports(), run(), poll?(), cancel?(), recover?() }`. Cada uno declara lo que soporta realmente, y cada operación tiene su propia prueba real y su propio estado.
- **Router:** primero descarta todo modelo que no tenga la capacidad exacta. Después ordena por modalidad, formatos, resolución, duración, contexto, calidad, velocidad, costo conocido, disponibilidad, límites, preferencias, privacidad y si el proceso es local o externo. Modos manual, favoritos y automático. Devuelve `RouterDecision { model, reasons[] }` y el usuario puede cambiar el modelo. Si ningún modelo es compatible, no ejecuta nada y lo dice. Un precio desconocido se muestra como "desconocido".
- **Trabajos:** máquina de estados `queued, submitting, processing, completed, failed, cancelled, interrupted, recovery_required`. Cada trabajo distingue cinco momentos: solicitud creada, enviada, aceptada, resultado recibido o resultado desconocido. Lleva una llave local de idempotencia y usa la del proveedor cuando su API la admite. Al abrir la app se consultan los trabajos pendientes. Si no se puede verificar uno, pasa a `recovery_required` y se te pregunta antes de reintentarlo; nunca se reintenta solo un envío que el proveedor pudo haber aceptado.
- **Flujos:** `workflow_steps` y las relaciones entre trabajos y activos permiten representar cadenas como texto, imagen, video, narración y archivo final. Todavía no hay motor de agentes.

## 3. Base de datos: migración v3, solo agrega
- **Globales (sin `project_id`):** `providers_registry`, `capabilities`, `models`, `model_versions`, `model_capabilities`, `endpoints`, `auth_refs` (apunta a la clave cifrada que ya existe, nunca la duplica), `capability_tests`, `key_versions`.
- **De proyecto (con `project_id`, verificado en Repo en cada consulta, cambio y borrado):** `jobs`, `job_attempts`, `assets`, `asset_versions`, `asset_tags`, `asset_relations`, `workflow_steps`, y `model_configs` cuando guarda preferencias de un proyecto.
- La migración convierte los proveedores actuales en registros sin borrar ningún dato, configuración, conversación ni credencial. Una prueba de migración lo comprueba con una base v2 real.

## 4. Adaptadores de esta etapa
- **Texto:** OpenAI, Anthropic, Gemini, Azure OpenAI, xAI, DeepSeek, Mistral, Cohere y compatibles con OpenAI. Los modelos se importan solo desde la lista oficial del proveedor cuando existe; en los demás, el registro es manual.
- **Imagen:** OpenAI Images y Azure OpenAI con un despliegue de imágenes, con `image.generate` y `image.edit`.
- **Audio:** OpenAI (`audio.tts` y `audio.transcribe`) y ElevenLabs (`audio.tts`).

## 5. Almacenamiento y cifrado de archivos (igual en todos los teléfonos)
- **Estándar único:** AES-256-GCM en todos los dispositivos. El rendimiento se adapta a cada teléfono; la seguridad no.
- **Jerarquía de llaves:**
  - Android Keystore guarda una llave maestra no exportable. Usa StrongBox si existe y funciona, y si no, el nivel disponible en el teléfono.
  - Cada archivo tiene su propia llave de datos, envuelta (cifrada) con la llave maestra.
  - La app detecta y registra qué protección tiene realmente el teléfono, y no dice "hardware" sin haberlo comprobado.
- **Formato de archivo versionado:**
  - Encabezado autenticado con formato, versión, activo, versión de llave, tamaño de bloque, tamaño original, número de bloques y datos de recuperación.
  - Cada bloque lleva un IV único, su etiqueta GCM y un AAD que lo ata al activo, al proyecto, a la versión, a su posición, a la llave y a si es el último bloque.
  - Así se rechaza cualquier bloque alterado, reordenado, duplicado o eliminado. Nunca se entrega contenido verificado solo en parte.
- **Perfiles de rendimiento:** se eligen según lo que el teléfono tiene de verdad (memoria disponible, núcleos, arquitectura, espacio libre, batería y temperatura cuando Android lo informa), no según su nombre comercial.
  - Económico: bloques de 1 MB, una operación a la vez y escritura progresiva.
  - Intermedio: bloques de 1 a 2 MB y algo de concurrencia.
  - Alto: bloques de hasta 4 MB y más concurrencia, solo si hay memoria libre y temperatura normal.
  - Ningún perfil desactiva la verificación, reutiliza IV ni acorta las llaves.
- **Escritura atómica:** archivo temporal privado, cifrado desde el primer byte, verificación, renombrado y, al final, registro en la base. Al abrir la app se limpian los temporales abandonados. Un archivo incompleto nunca queda registrado.
- **Rotación de llaves:** con versiones. Se vuelven a envolver las llaves de datos sin volver a cifrar los archivos. Se puede interrumpir y reanudar, y una llave antigua no se borra mientras algún archivo la use.
- **Respaldo a otro teléfono:** las llaves del Keystore no se pueden transferir. Por eso el respaldo vuelve a envolver las llaves de datos con una llave derivada de tu contraseña de respaldo (PBKDF2-SHA256, 600 000 iteraciones, con versión). La contraseña nunca se guarda ni aparece en registros. Las API Keys nunca se incluyen.
- **Límite honesto:** este cifrado no protege por completo ante un teléfono comprometido, malware con privilegios o alguien con acceso legítimo a la app.

## 6. Pantallas
- **Modelos:** proveedor, identificador, versión, capacidades, entradas y salidas, límites, estado, última prueba, probar conexión, importar o registrar a mano.
- **Biblioteca:** activos por proyecto con vista ampliada, reproducción, exportación, eliminación, metadatos, etiquetas, búsqueda y versiones.
- **Trabajos:** filtros por estado y reintento controlado (confirmado por ti si hay duda).
- **Chat:** selector filtrado por capacidad, modos manual, favorito o automático, y el motivo de la elección.
- Todo diseñado para pantallas pequeñas como la de tu Poco C40.

## 7. Riesgos y limitaciones
- Las pruebas reales necesitan tus claves con acceso a imagen y audio. Sin ellas, esas operaciones quedan como "Programadas".
- No puedo probar en tu Poco C40, en un teléfono intermedio ni en un Galaxy S26. El perfil alto quedará "implementado, pendiente de validación física".
- El emulador de este entorno no arranca rápido. La prueba en Android emulado se intentará en GitHub Actions; si no corre, se informa como no ejecutada.
- La temperatura y la batería dependen de lo que Android exponga; si no hay dato, el perfil se queda en económico.
- Etapa grande: se entrega en un solo paquete, pero quizá necesite más de una sesión de trabajo.

## 8. Plan de pruebas
- **Unitarias e integración:** registro y varias capacidades por modelo, adaptadores, el router (nunca elige un modelo incompatible), transiciones de trabajos, idempotencia y recuperación, migración v2 a v3 sin pérdida, aislamiento entre proyectos y regresión de los proveedores actuales.
- **Criptográficas:** archivos vacíos, pequeños, medianos y grandes; imagen y audio; archivos alterados; bloques reordenados, duplicados o eliminados; encabezado alterado; etiqueta GCM o IV inválidos; IV únicos; interrupción al escribir o leer; rotación; restauración con contraseña correcta e incorrecta; disco lleno y error de almacenamiento.
- **Reales:** una imagen y un audio generados con tus claves.
- **Niveles de prueba que se reportarán:** unitaria, web con sql.js, compilación en GitHub Actions, Android emulado, Poco C40, teléfono intermedio y Galaxy S26.
- **Rendimiento:** la APK incluye una pantalla de diagnóstico que mide en tu teléfono el tiempo de cifrado y descifrado, la memoria y la velocidad. Los resultados de los teléfonos los tomas tú.

## 9. Criterios de aceptación
1. Los proveedores existentes conservan su funcionamiento.
2. Las migraciones no pierden datos.
3. El registro admite varios modelos y varias capacidades por modelo.
4. Los adaptadores nuevos completan operaciones reales antes de marcarse como funcionales.
5. El router nunca elige un modelo incompatible; si no hay uno compatible, no ejecuta nada.
6. Un trabajo interrumpido se recupera o queda en `recovery_required`, sin cobros duplicados.
7. Un archivo manipulado siempre se rechaza.
8. Ningún proyecto ve datos de otro.
9. Se entrega la APK con un informe de estados por operación y por nivel de prueba.

Tu mensaje llegó cortado en el criterio 5. Si ese criterio o los siguientes dicen algo distinto, envíamelos y ajusto esta sección.

## Detalles técnicos
- Cifrado nativo: un plugin de Capacitor propio (Kotlin), generado desde `android-prepare.sh`, con `KeyGenParameterSpec`, StrongBox de forma opcional y AES/GCM por streaming. Solo se transfieren bloques entre la interfaz y la parte nativa, nunca el archivo completo. En la vista web se usa el mismo formato con WebCrypto y los activos en sql.js, solo para desarrollo.
- Las llaves de datos se envuelven con AES-256-GCM (llave maestra en el Keystore) y la versión queda en `key_versions`.
- AAD = `assetId|projectId|formatVer|keyId|blockIndex|isFinal`. El encabezado se autentica como AAD del primer bloque, y una etiqueta final cubre el número total de bloques.
