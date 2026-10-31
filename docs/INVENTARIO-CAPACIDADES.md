# MI AI — Inventario de capacidades

Estados: **Programada** (código existe) · **Web** (probada en vista de desarrollo) · **Emulador** · **Físico** · **Pendiente** (aún no programada).
Ninguna capacidad se marca "funcional con proveedor" sin una operación real con credenciales del usuario.

| Capacidad | Estado | Adaptador / proveedor | Dependencias | Costo | Pruebas | Fase |
|---|---|---|---|---|---|---|
| chat | Programada · Web · Físico (Poco C40, usuario) | 10 tipos de texto + Azure OpenAI | Registro, router | Por token del proveedor | Unitarias + real del usuario (Azure) | 1 |
| reasoning | Programada (texto) | Modelos de razonamiento vía chat | chat | Por token | Sin prueba real | 1 |
| vision.analyze | Pendiente | — | adjuntos cifrados | — | — | 2 |
| image.generate | Programada · Web (UI) | OpenAI Images, Azure OpenAI Images | Biblioteca cifrada, jobs | Por imagen | Unitarias con respuestas simuladas; sin operación real | 1 |
| image.edit | Programada | OpenAI Images (edits) | image.generate, versiones | Por imagen | Unitarias; sin operación real | 1 |
| image.upscale / image.remove_bg | Pendiente | — | image.edit | — | — | 2 |
| audio.tts | Programada | OpenAI TTS, ElevenLabs | Biblioteca | Por carácter | Unitarias; sin operación real | 1 |
| audio.stt | Programada | OpenAI transcripciones | Biblioteca | Por minuto | Unitarias; sin operación real | 1 |
| audio.voice_clone | Pendiente | ElevenLabs | audio.tts, consentimiento | — | — | 3 |
| music.generate | Pendiente | — | jobs largos | — | — | 7 |
| video.generate / video.edit | Pendiente | — | jobs largos con sondeo | — | — | 6 |
| model3d.generate | Pendiente | — | jobs largos | — | — | 6 |
| document.analyze / document.create | Pendiente (docs v1 de Fase 1 existen) | — | biblioteca | — | — | 4 |
| research.web | Pendiente | — | herramientas | — | — | 5 |
| code.execute | Pendiente | — | sandbox | — | — | 8 |
| agent.run / workflow.run | Pendiente (tablas de workflow listas) | — | router, jobs | — | — | 8 |
| embeddings | Pendiente | — | memoria | — | — | 5 |

## Núcleo (Etapa 1)
| Componente | Estado |
|---|---|
| Registro de proveedores/modelos/capacidades + migración de proveedores existentes | Programada · Web · unitarias |
| Router exacto (manual / favorito / automático con razones) | Programada · Web · unitarias |
| Job Manager (8 estados, idempotencia, recovery_required) | Programada · unitarias |
| Archivo cifrado AES-256-GCM, DEK por archivo, nonce prefijo+contador, registro final | Programada · unitarias (manipulación, truncamiento, vacío, 8 MiB) |
| Llaves maestras versionadas + rotación | Programada · Web · unitarias |
| Plugin Android Keystore/StrongBox | Programada; no compilada ni ejecutada en Android aún |
| Respaldo v2 Argon2id (PBKDF2 600 000 alternativo), restauración entre dispositivos | Programada · Web (exportación) · unitarias |
| Pantallas Modelos, Biblioteca, Trabajos, Diagnóstico, chat Automático/Favorito | Programada · Web |
