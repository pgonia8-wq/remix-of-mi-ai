# MI AI — Roadmap

## Etapa 1 — Núcleo universal (en curso)
- [ ] docs/ESPECIFICACION-MAESTRA.md y docs/INVENTARIO-CAPACIDADES.md
- [ ] Capacidades como datos (21 iniciales) + registro (providers_registry, models, versions, endpoints, auth_refs, tests)
- [ ] Migración v3 aditiva + conversión de proveedores existentes
- [ ] Model Router (manual/favorito/automático, razones, sin modelo incompatible)
- [ ] Job Manager (8 estados, idempotencia, recovery_required)
- [ ] Formato de archivo cifrado (DEK por archivo, nonce prefijo+contador, AAD, registro final) + escritura atómica
- [ ] Llaves maestras versionadas, plugin nativo Keystore/StrongBox, rotación
- [ ] Respaldo v2 con Argon2id/PBKDF2 y re-envoltura de DEK
- [ ] Adaptadores: texto (envoltura), OpenAI Images, Azure Images, OpenAI audio, ElevenLabs
- [ ] Pantallas: Modelos, Biblioteca, Trabajos, Diagnóstico; selector de capacidad en chat
- [ ] Pruebas unitarias/cripto/router/jobs/migración
- [ ] APK Etapa 1 + informe por niveles
- [ ] Bloqueado: operaciones reales de imagen/audio (claves del usuario)
- [ ] Bloqueado: pruebas físicas Poco C40 / intermedio / Galaxy S26 (usuario)
- [ ] Bloqueado: clave de firma Release (usuario)

## Fase 1 (completada)
- [x] Proyectos, chats, memoria, documentos, proveedores con prueba real, Azure OpenAI, respaldo cifrado, APK build.3
- [x] Probado por el usuario en Poco C40: APK abre, chat funciona, proveedor persiste
