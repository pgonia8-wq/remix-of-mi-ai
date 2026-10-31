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

## Fase 2 — Imagen y visión (en curso)
- [x] Visión (analizar imagen) OpenAI y Azure OpenAI + prueba real mínima + análisis guardado cifrado en Biblioteca
- [ ] Bloqueado: prueba real de visión con tus claves
- [x] Herramientas locales sin costo (rotar, voltear, recortar, escalar, convertir) como versiones nuevas cifradas
- [x] Historial de versiones, subir imágenes/audio a la Biblioteca, generar 1–4 imágenes
- [ ] Más adelante (usuario): integrar sus ~290 modelos de Azure (registro masivo) — luego quitar fondo/upscale con IA

## Fase 1 (completada)
- [x] Proyectos, chats, memoria, documentos, proveedores con prueba real, Azure OpenAI, respaldo cifrado, APK build.3
- [x] Probado por el usuario en Poco C40: APK abre, chat funciona, proveedor persiste
