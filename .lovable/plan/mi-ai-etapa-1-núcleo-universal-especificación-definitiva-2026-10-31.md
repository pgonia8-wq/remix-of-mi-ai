# MI AI, Etapa 1: Núcleo universal (especificación definitiva)

Este plan amplía lo que ya existe; no lo reescribe. Cada operación de cada proveedor se reporta por separado como: Diseñada, Programada, Integrada, Probada en web, Probada en Android o Probada en dispositivo físico.

## 0. Plan integral de MI AI (alcance universal completo)
Antes de escribir código, se crean dos documentos dentro del proyecto:
- `docs/ESPECIFICACION-MAESTRA.md`: une tus cinco documentos en una sola visión y marca qué decisiones aprobadas aplica cada parte. No hay contradicciones: el alcance universal se monta sobre este núcleo local, cifrado y para Android.
- `docs/INVENTARIO-CAPACIDADES.md`: una ficha por cada capacidad de las secciones 2 a 22 con sus nueve datos (estado actual, trabajo pendiente, dependencias, tecnología, proveedor o API, costos y limitaciones, pruebas, criterio de aceptación y fase). Nada se elimina: lo que dependa de una API, un acceso, un presupuesto o un hardware que todavía no existe queda documentado como "pendiente por dependencia".

Fases decididas por dependencia técnica (cada una entrega su propia APK):
| Fase | Contenido | Depende de |
|---|---|---|
| 1. Núcleo universal | Este plan: registro, router, trabajos, biblioteca, cifrado de archivos, respaldos y diagnóstico | Fase 1 actual (hecha) |
| 2. Imagen y visión | Crear y editar imágenes, galería con versiones, OCR, análisis de fotos y documentos | 1 |
| 3. Audio y voz | Texto a voz, transcripción, traducción de voz, conversación por voz en tiempo real | 1 |
| 4. Documentos y productividad | Editor de documentos, PDF y Word, presentaciones, hojas de cálculo, análisis de datos | 1, 2 (OCR) |
| 5. Investigación y educación | Búsqueda web con fuentes, investigación profunda, tutor, cuestionarios | 1, 4 |
| 6. Video | Generación por trabajos largos y editor con línea de tiempo (FFmpeg nativo) | 1, 2, 3 |
| 7. Música y sonido | Música, efectos y separación de pistas | 1, 3, 6 |
| 8. Agentes y automatizaciones | Herramientas, varios agentes, flujos encadenados y tareas programadas | 1 a 5 (flujos preparados en la fase 1) |
| 9. Espacio profesional | Archivos, editor de código, ejecución, Termux, SSH, GitHub y nubes | 1, 8 |

Las fases 2 y 3 se pueden construir en paralelo. Costos, cuotas, privacidad, derechos y consentimiento (secciones 21 y 22) son transversales: se aplican en cada fase. Cada operación muestra si se procesa en el teléfono o en un proveedor externo, y su costo conocido o "desconocido".

Esta aprobación cubre: los dos documentos y la Fase 1 descrita abajo. Las fases 2 a 9 se presentarán una por una, con su propio plan.

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
- **IV únicos garantizados, sin depender del azar:**
  - Nonce de 96 bits = prefijo aleatorio de 32 bits por archivo + contador de bloque de 64 bits.
  - Cada archivo usa su propia llave de datos, nueva en cada escritura, así que la pareja llave–IV nunca se repite. Esto se cumple también en reintentos, en recuperaciones y al rotar llaves, porque re-cifrar siempre crea una llave nueva.
  - El contador solo avanza, tiene un límite que se controla y la escritura es secuencial, sin bloques fuera de orden.
- **Formato de archivo versionado:**
  - Encabezado autenticado (también en archivos vacíos) con formato, versión, activo, proyecto, versión de llave, tamaño de bloque y datos de recuperación.
  - Cada bloque lleva su IV, su etiqueta GCM y un AAD que lo ata al activo, al proyecto, a la versión, a la llave y a su posición.
  - **Registro final autenticado:** certifica el activo, el proyecto, la versión, la llave, el total de bloques, el tamaño original, el orden y que el archivo terminó. Sin este registro, el archivo se considera incompleto.
  - Se rechaza cualquier bloque alterado, reordenado, duplicado o eliminado. Nunca se entrega contenido verificado solo en parte.
- **Perfiles de rendimiento:** se eligen según lo que el teléfono tiene de verdad (memoria disponible, núcleos, arquitectura, espacio libre, batería y temperatura cuando Android lo informa), no según su nombre comercial. Los tamaños de bloque y de buffer, la concurrencia, la memoria y la frecuencia de escritura se ajustan durante el trabajo; los valores de abajo solo son el punto de partida.
  - Económico: bloques de 1 MB, una operación a la vez y escritura progresiva.
  - Intermedio: bloques de 2 MB, con el cifrado de un bloque solapado con la escritura del anterior.
  - Alto: bloques de 4 MB y más bloques preparados en paralelo, solo si hay memoria libre y temperatura normal. Siempre se escriben en orden.
  - Ningún perfil desactiva la verificación, reutiliza IV ni acorta las llaves.
- **Escritura atómica:** archivo temporal privado, cifrado desde el primer byte, verificación, renombrado y, al final, registro en la base. Al abrir la app se limpian los temporales abandonados. Un archivo incompleto nunca queda registrado.
- **Rotación de llaves:** con versiones. Se vuelven a envolver las llaves de datos sin volver a cifrar los archivos. Se puede interrumpir y reanudar, y una llave antigua no se borra mientras algún archivo la use.
- **Llave de respaldo:**
  - Se deriva de tu contraseña con Argon2id, cuyos parámetros se ajustan a la memoria del teléfono dentro de límites seguros y documentados. Si Argon2id no está disponible, se usa PBKDF2-HMAC-SHA256 con al menos 600 000 iteraciones.
  - Cada respaldo guarda la sal, el algoritmo, la versión, los parámetros y su formato. La contraseña y la llave derivada nunca se guardan ni aparecen en registros.
  - La app recomienda contraseñas fuertes y verifica que el respaldo sea auténtico antes de restaurar.
- **Restauración en otro teléfono, paso a paso:**
  1. Verificar el respaldo.
  2. Pedir la contraseña.
  3. Derivar la llave de recuperación.
  4. Recuperar y verificar las llaves de datos.
  5. Crear una jerarquía de llaves nueva en el Keystore del teléfono nuevo.
  6. Volver a envolver las llaves de datos para ese teléfono.
  7. Restaurar los activos.
  8. Verificar la integridad de todo.
  
  Si se interrumpe, se puede reanudar, y nunca se modifica el archivo de respaldo. Las API Keys no viajan en el respaldo: se te piden de nuevo y se comprueban con una prueba de conexión.
- **Pantalla de diagnóstico:**
  - Muestra el nivel real del Keystore, si StrongBox está disponible y si se usa de verdad, la arquitectura, la memoria, el perfil elegido, el tamaño de bloque, la concurrencia, los tiempos de cifrado y descifrado, la memoria máxima usada, y los errores y limitaciones.
  - Guarda los resultados por separado para cada teléfono, para que el Poco C40, un intermedio y el Galaxy S26 queden registrados aparte.
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
- AAD de cada bloque = `hash(encabezado)|assetId|projectId|formatVer|keyId|blockIndex`.
- Registro final: un bloque GCM con contador = 2^64−1 (reservado) que cifra `{totalBlocks, originalSize, sha256 de las etiquetas de los bloques}`. Así queda autenticado incluso con cero bloques de datos.
- Argon2id con libsodium o argon2 en Kotlin en Android, y argon2-wasm en la vista web. Parámetros iniciales: 64 MiB y 3 pasadas, que bajan hasta un mínimo de 19 MiB y 2 pasadas en teléfonos con poca memoria.
- Aceptación criptográfica: el motor no se considera terminado hasta superar todas las pruebas del documento de cierre técnico (unicidad de IV, encabezado, bloques, registro final, manipulaciones, interrupciones, rotación, contraseña correcta e incorrecta, migración a otro teléfono y archivos grandes con poca memoria).
