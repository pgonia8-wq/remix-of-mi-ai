# MI AI, Etapa 1: Núcleo universal (incluye ampliación y correcciones)

Este plan amplía lo que ya existe; no lo reescribe. Cada función se reportará como: Diseñada, Programada, Integrada, Probada en web, Probada en Android o Probada en dispositivo físico.

## 1. Arquitectura existente que se conserva
| Pieza | Decisión |
|---|---|
| Proyectos, chats y memoria aislados (Repo con `projectId`) | Se reutiliza sin cambios |
| SQLCipher en Android, sql.js en la vista web | Se reutiliza y solo se agregan tablas |
| Llave AES en Android Keystore y cifrado AES-GCM de las API Keys | Se reutiliza y se amplía a archivos |
| Proveedores de texto y Azure, con su prueba de conexión real | Se envuelven como el primer adaptador, sin cambiar su comportamiento |
| Respaldo y restauración cifrados | Se amplía con modelos, trabajos y activos |
| Capacitor, APK automática y script de preparación de Android | Se reutiliza; solo se agrega el plugin de archivos |

Antes de modificar cada pieza se revisará su código y se documentará en el informe si se reutiliza, se amplía o se corrige.

## 2. Arquitectura nueva
```text
Pantallas: Modelos · Biblioteca · Trabajos · Chat (selector)
        |
   Model Router  -> explica la elección; el usuario puede cambiarla
        |
   Job Manager (estados persistentes, recuperación)
        |
   Adaptadores, uno por proveedor o familia de API
   (texto existente · imagen · audio)
        |
   Registry (Provider, Model, ModelVersion, Capability,
             Endpoint, Configuration, AuthenticationReference)
        |
   Repo -> SQLCipher      Asset Store -> archivos cifrados privados
```
- **Capacidades:** las identifica un texto (`chat`, `image.generate`, `audio.tts` y las demás de la lista que diste). Su descripción (entradas, salidas, formatos, parámetros, límites, si es síncrona o asíncrona, si se puede cancelar o recuperar) se guarda como datos. Así se agregan capacidades nuevas sin cambiar la base de datos.
- **Adaptadores:** cada uno declara las operaciones que soporta realmente, y cada operación tiene su propia prueba real y su propio estado.
- **Router:** filtra estrictamente por la capacidad exacta y después ordena por formato, calidad, contexto, velocidad, costo conocido, disponibilidad, límites, preferencias y privacidad. Ofrece modo manual, favorito o automático. Si ningún modelo es compatible, lo dice claramente; nunca cambia de operación sin avisar.
- **Trabajos:** estados `queued → submitting → processing → completed | failed | cancelled | interrupted | recovery_required`, con transiciones controladas. Al abrir la app se retoman los pendientes. Si el estado anterior no puede verificarse, el trabajo pasa a `recovery_required` y no se reintenta automáticamente, para no cobrarte dos veces.
- **Flujos:** la tabla `workflow_steps` relaciona trabajos y activos de entrada y salida. Se prepara la estructura, sin motor de agentes por ahora.

## 3. Cambios de base de datos (migración v3, solo agrega)
`providers_registry`, `models`, `model_versions`, `capabilities`, `model_capabilities`, `endpoints`, `model_configs`, `auth_refs` (apunta a la clave cifrada ya existente, nunca la duplica), `capability_tests`, `jobs`, `job_attempts`, `assets`, `asset_relations`, `workflow_steps`.
- Todas las tablas de proyecto llevan `project_id` y se filtran en Repo.
- La migración convierte los proveedores actuales en registros, sin perder datos ni verificaciones.

## 4. Adaptadores de esta etapa
- **Texto (existente):** OpenAI, Anthropic, Gemini, Azure OpenAI, xAI, DeepSeek, Mistral, Cohere y compatibles con OpenAI. Se agrega importar la lista de modelos de cada proveedor cuando su API la ofrece.
- **Imagen:** OpenAI Images (gpt-image) y Azure OpenAI con un despliegue de imágenes. Este segundo usa tu cuenta Azure. Operaciones: `image.generate` y `image.edit`.
- **Audio:** OpenAI (`audio.tts` y `audio.transcribe`) y ElevenLabs (`audio.tts`).

## 5. Riesgos y limitaciones
- Las operaciones reales necesitan tus claves con acceso a esos modelos. Sin ellas, el proveedor queda como "Programado", nunca como "Funcional".
- No puedo instalar ni probar en tu Poco C40. Esa columna la llenas tú.
- El emulador de este entorno no arranca rápido. La prueba en Android se hará en GitHub Actions; si falla, se informará como no ejecutada.
- Archivos grandes en un teléfono de gama baja: se cifran por bloques para no cargarlos completos en memoria.
- No todos los proveedores permiten cancelar o consultar trabajos. Cada adaptador lo declara.

## 6. Plan de pruebas
- Unitarias y de integración: registro y actualización de modelos, varias capacidades por modelo, compatibilidad de adaptadores, que el router nunca elija un modelo incompatible, transiciones de trabajos, recuperación tras cerrar la app, reintentos sin duplicar cobros, cifrado e integridad de archivos (incluido un archivo alterado que debe ser rechazado), aislamiento entre proyectos, respaldo y restauración con activos, y que los proveedores actuales sigan funcionando igual.
- Reales: una generación de imagen y una de audio con tus claves en la vista web, y después en tu teléfono.

## 7. Criterios de aceptación verificables
1. Las pruebas existentes y las nuevas pasan; ningún proveedor actual cambia su comportamiento.
2. Un proyecto no puede ver modelos, trabajos ni activos de otro proyecto (cubierto por pruebas).
3. Al pedir una capacidad sin modelo compatible, la app muestra un mensaje claro y no ejecuta nada.
4. Si cierras la app con un trabajo en curso, al volver a abrirla aparece recuperado o como `recovery_required`.
5. En el almacenamiento solo hay archivos cifrados; un archivo alterado se rechaza.
6. La imagen y el audio generados aparecen en la Biblioteca y se pueden ver, reproducir, exportar y borrar.
7. Se entrega la APK de la Etapa 1 con el informe de estados por función.

## Detalles técnicos
- Se agrega `@capacitor/filesystem` (directorio Data) mediante `scripts/android-prepare.sh`. Escritura atómica: se escribe en un archivo temporal, se verifica y se renombra.
- Formato de archivo cifrado: encabezado con la versión de la llave, y bloques de 1 MB, cada uno con IV único y su etiqueta de integridad GCM. Las llaves llevan versión para poder rotarlas.
- En la vista web, los activos se guardan en la base sql.js, solo para desarrollo, con el mismo formato cifrado.
- Contratos en TypeScript: `CapabilitySpec`, `ProviderAdapter { supports(), run(), poll?(), cancel?() }`, `RouterDecision { model, reasons[] }`.
