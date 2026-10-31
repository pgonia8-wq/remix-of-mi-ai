# MI AI: diagnóstico y plan por etapas (especificación universal)

## Por qué la app se ve tan sencilla
Hasta ahora solo se aprobó y se construyó la Fase 1: la base segura sobre la que se apoya todo lo demás. Las herramientas, la parte creativa, los agentes y el espacio de trabajo nunca entraron en ese alcance.

## Diagnóstico: lo que ya funciona y se conserva
| Pieza | Estado | Uso en las etapas nuevas |
|---|---|---|
| Proyectos, chats y memoria aislados por proyecto | Probado en tu Poco C40 | Base para la biblioteca y el historial |
| Base de datos local cifrada (SQLCipher) | Compilada para Android | Guarda modelos, trabajos y archivos |
| API Keys cifradas con Android Keystore | Programado | Se usa igual para todos los proveedores nuevos |
| Proveedores de texto con prueba real (incluido Azure) | Probado en tu Poco C40 | Se convierte en el primer adaptador del nuevo núcleo |
| Respaldo y restauración cifrados | Programado y probado en web | Se amplía a los archivos generados |
| APK automática en GitHub | Funciona | Igual para cada etapa |

No se reemplaza nada de lo anterior.

## Etapas (en orden de dependencia)
1. **Núcleo universal (siguiente paso):** catálogo de modelos con sus capacidades reales, adaptadores por proveedor, un selector que elige el modelo adecuado para cada tarea, un gestor de trabajos largos (en cola, procesando, completado, error, cancelado, con reintento) y una biblioteca de archivos generados. Complejidad alta, pero todas las demás etapas dependen de ella.
2. **Creación multimodal (MI AI CREATE):** imágenes y su edición, video, editor de video, audio, voz y música. Depende de la etapa 1. Complejidad muy alta, sobre todo el editor de video en un teléfono de gama baja.
3. **Productividad:** documentos, presentaciones, hojas de cálculo, investigación web, análisis de imágenes y de datos.
4. **Espacio profesional:** archivos, editor, terminal o Termux, SSH, GitHub y nubes.
5. **Inteligencia avanzada:** agentes, orquestación, automatizaciones y herramientas encadenadas.

Cada etapa se entrega como su propia APK, y cada función con su estado: diseñada, programada, integrada, probada en web, probada en Android y probada en dispositivo físico.

## Alcance concreto de la Etapa 1
- Pantalla **Modelos**. Para cada modelo muestra el proveedor, su identificador, qué entradas y salidas acepta (texto, imagen, audio, video), sus límites, su estado de conexión y la fecha de la última prueba.
- Agregar modelos a mano o importarlos de la lista que ofrece el propio proveedor cuando existe esa lista (OpenAI, Gemini, Mistral, compatibles con OpenAI, Hugging Face). Los que dejan de existir se marcan como retirados.
- Primeros adaptadores nuevos, que ya dejan lista la etapa 2: un proveedor de imágenes (OpenAI Images o Stability) y uno de audio (ElevenLabs o Deepgram). Cada uno debe completar una operación real antes de marcarse como funcional.
- Gestor de trabajos con progreso, cancelación y recuperación al volver a abrir la app.
- **Biblioteca** por proyecto con imágenes, audios y archivos, vista ampliada y descarga. Todo queda cifrado en el teléfono.
- Selector de modelo en el chat filtrado por capacidad.

## Detalles técnicos
- Contrato de capacidad normalizado (por ejemplo `chat`, `image.generate`, `audio.tts`). Un adaptador por proveedor declara las capacidades que soporta. El selector elige el modelo según la capacidad y la configuración del usuario. Nunca habrá una única función que maneje todos los proveedores.
- Tablas nuevas: `models`, `model_capabilities`, `jobs`, `assets`. Todas filtradas por `projectId` a través de Repo.
- Los archivos binarios se guardan en el almacenamiento de la app, cifrados con AES-GCM. En la base de datos solo queda su ubicación, para no cargar archivos grandes en la memoria.
- Todo sigue ejecutándose en el teléfono con tus propias claves, sin servidor obligatorio.
- Pruebas unitarias del registro de modelos, del selector, de las transiciones del gestor de trabajos y del aislamiento entre proyectos.
