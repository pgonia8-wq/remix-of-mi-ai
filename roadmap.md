# MI AI — Roadmap

## Etapa 1 — Núcleo universal (en curso)
- [x] docs/ESPECIFICACION-MAESTRA.md y docs/INVENTARIO-CAPACIDADES.md
- [x] Capacidades como datos (21 iniciales) + registro (providers_registry, models, versions, endpoints, auth_refs, tests)
- [x] Migración v3 aditiva + conversión de proveedores existentes
- [x] Model Router (manual/favorito/automático, razones, sin modelo incompatible)
- [x] Job Manager (8 estados, idempotencia, recovery_required)
- [x] Formato de archivo cifrado (DEK por archivo, nonce prefijo+contador, AAD, registro final) + escritura atómica
- [x] Llaves maestras versionadas, plugin nativo Keystore/StrongBox, rotación
- [x] Respaldo v2 con Argon2id/PBKDF2 y re-envoltura de DEK
- [x] Adaptadores: texto (envoltura), OpenAI Images, Azure Images, OpenAI audio, ElevenLabs
- [x] Pantallas: Modelos, Biblioteca, Trabajos, Diagnóstico; selector de capacidad en chat
- [x] Pruebas unitarias/cripto/router/jobs/migración
- [ ] APK Etapa 1 + informe por niveles
- [ ] Bloqueado: operaciones reales de imagen/audio (claves del usuario)
- [ ] Bloqueado: pruebas físicas Poco C40 / intermedio / Galaxy S26 (usuario)
- [ ] Bloqueado: clave de firma Release (usuario)

## Fase 2 — Imagen y visión (completada en código)
- [x] Visión (analizar imagen) OpenAI y Azure OpenAI + prueba real mínima + análisis guardado cifrado en Biblioteca
- [ ] Bloqueado: prueba real de visión con tus claves
- [x] Herramientas locales sin costo (rotar, voltear, recortar, escalar, convertir) como versiones nuevas cifradas
- [x] Historial de versiones, subir imágenes/audio a la Biblioteca, generar 1–4 imágenes
- [x] Eliminar fondo y mejorar resolución con IA para cualquier modelo que declare la capacidad
- [ ] Más adelante (usuario): registro masivo de sus ~290 modelos de Azure

## Fase 3 — Audio y voz (completada en código)
- [x] Texto a voz con selección de voz y velocidad (OpenAI, Azure OpenAI, ElevenLabs)
- [x] Transcribir y traducir audio (OpenAI, Azure OpenAI, ElevenLabs Scribe), grabando o subiendo archivo
- [x] Clonar voz (ElevenLabs) con consentimiento obligatorio; solo se guarda el ID de la voz
- [x] Chat: dictado por micrófono y «Leer en voz alta»; permiso de micrófono en Android
- [ ] Bloqueado: pruebas reales con claves del usuario

## Fase 4 — Documentos y productividad (completada en código)
- [x] Leer PDF, Word, Excel/CSV y texto en el teléfono; resumir, preguntar, extraer tablas, datos clave y pendientes
- [x] Crear documentos con plantillas y exportar a PDF, Word, Excel y Markdown
- [x] Notas y tareas por proyecto; tareas extraídas de un texto con IA

## Fase 5 — Investigación y educación (completada en código)
- [x] Investigación web con Tavily (clave del usuario), búsqueda profunda, citas numeradas y aviso de citas inválidas
- [x] Memoria inteligente (embeddings OpenAI/Azure) usada automáticamente por el chat
- [x] Estudio: explicar, cuestionarios, tarjetas con repaso espaciado, planes de estudio

## Siguiente
- [ ] Solicitud actual: ampliar Fase 6 (motor de flujos, delegación revisada, desarrollo e integraciones) y construir Fase 7 (espacio profesional)
- [x] Fase 6 (antes 8), entrega parcial: agentes por proyecto, secuencias revisadas, condiciones de texto, repeticiones limitadas, historial, aprobación, límites y JavaScript aislado
- [x] Compilar APK build.4 con Fases 1–5 y la entrega parcial de Fase 6; comprobar firma, minSdk y ABI
- [ ] Fase 6 pendiente: terminal/Termux, SSH/SFTP, Git/GitHub, integraciones externas con autorización (sin conectores implementados)
- [ ] Fase 6 pendiente: delegación autónoma, resolución de conflictos, ramas generales, disparadores y programación Android (motor aún secuencial/manual)
- [ ] Bloqueado: validar APK build.4, SQLCipher/Keystore y JavaScript en Android/Poco C40 (sin teléfono ni emulador acelerado disponible)
- [ ] Bloqueado: pruebas reales con claves del usuario (Azure, Tavily, ElevenLabs)

## Orden pendiente solicitado
- Fase 7 (antes 9): espacio profesional
- Fase 8 (antes 7): música
- Fase 9 (antes 6): video y 3D

## Fase 1 (completada)
- [x] Proyectos, chats, memoria, documentos, proveedores con prueba real, Azure OpenAI, respaldo cifrado, APK build.3
- [x] Probado por el usuario en Poco C40: APK abre, chat funciona, proveedor persiste
