# MI AI — Inventario de capacidades

Estados: **Programada** (código existe) · **Web** (probada en vista de desarrollo) · **Emulador** · **Físico** · **Pendiente** (aún no programada).
Ninguna capacidad se marca "funcional con proveedor" sin una operación real con credenciales del usuario.

| Capacidad | Estado | Adaptador / proveedor | Dependencias | Costo | Pruebas | Fase |
|---|---|---|---|---|---|---|
| chat | Programada · Web · Físico (Poco C40, usuario) | 10 tipos de texto + Azure OpenAI | Registro, router | Por token del proveedor | Unitarias + real del usuario (Azure) | 1 |
| reasoning | Programada (texto) | Modelos de razonamiento vía chat | chat | Por token | Sin prueba real | 1 |
| vision | Programada · unitarias | OpenAI, Azure OpenAI (chat/completions con imagen) | Biblioteca cifrada | Por token | Unitarias; sin operación real | 2 |
| image.generate | Programada · Web (UI) | OpenAI Images, Azure OpenAI Images | Biblioteca cifrada, jobs | Por imagen | Unitarias con respuestas simuladas; sin operación real | 1 |
| image.edit | Programada | OpenAI Images (edits) | image.generate, versiones | Por imagen | Unitarias; sin operación real | 1 |
| image.upscale / image.remove_bg | Programada · unitarias | Cualquier modelo OpenAI/Azure con images/edits | image.edit | Por imagen | Unitarias; sin operación real | 2 |
| audio.tts | Programada | OpenAI, Azure OpenAI, ElevenLabs (voces) | Biblioteca | Por carácter | Unitarias; sin operación real | 1 |
| audio.transcribe | Programada · Web (micrófono) | OpenAI, Azure OpenAI, ElevenLabs | Biblioteca | Por minuto | Unitarias; sin operación real | 1 |
| audio.voice_clone | Programada · Web (grabación) · unitarias | ElevenLabs | consentimiento | Según plan | Unitarias; sin operación real | 3 |
| audio.translate | Programada · unitarias | OpenAI, Azure OpenAI | — | Por minuto | Unitarias | 3 |
| music.generate / audio.sfx | Programada · Web (pantalla) · unitarias | ElevenLabs music / sound-generation; independientes de TTS | clave y modelo compatible; licencia por plan | proveedor | contratos controlados, sin generación real con clave | 8 |
| video.generate / video.edit | Programada · Web (pantalla) · unitarias | Runway text/image/video-to-video | trabajos remotos persistentes y consulta | proveedor | contratos controlados; sin generación real | 9 |
| model3d.generate | Programada · Web (importar/visor GLB real) · unitarias | Meshy texto/imagen a GLB; Three.js para visor local | trabajos remotos persistentes | proveedor / visor local gratis | GLB cifrado reaparece tras recarga; no generación real | 9 |
| document.analyze / crear documentos | Programada · Web (lectura PDF/DOCX) · unitarias | Lectura local + cualquier modelo de chat; exportación local PDF/DOCX/XLSX | router chat | Por token | Unitarias; sin operación real | 4 |
| notas y tareas | Programada · Web · unitarias | Local | — | Sin costo | Unitarias + persistencia web | 4 |
| research.web | Programada · unitarias | Tavily + modelo de chat | router | Por búsqueda + tokens | Unitarias; sin operación real | 5 |
| estudio (cuestionarios, tarjetas SM-2, planes) | Programada · Web · unitarias | Cualquier modelo de chat | — | Por token | Unitarias | 5 |
| code.execute (JavaScript síncrono) | Programada · Web · unitarias · APK compilada | QuickJS WASM en worker sin puentes al host | límites memoria/tiempo/salida | Local sin costo | Ejecución real en Chromium; pendiente Android | 6 |
| agent.run / workflow.run (secuencias revisadas) | Programada · Web local · unitarias · APK compilada | Herramientas permitidas, router exacto, aprobaciones, límites | agentes por proyecto, jobs, biblioteca | Por solicitud externa | Flujo real guardar nota; sin proveedores reales | 6 |
| Terminal SSH / SFTP / Git remoto / abrir Termux | Programada · APK build.5 compilada; no ejecutada Android | JSch nativo, known_hosts estricto, autorización nativa | servidor Linux, Termux instalado | servidor del usuario | Sin ejecución real | 6–7 |
| GitHub archivos y commits | Programada; pantalla Web | API GitHub on-device, token cifrado fuera de respaldos | token y repositorio autorizados | proveedor | Sin cuenta real probada | 6–7 |
| Ramas, dependencias, delegación y revisión de conflictos | Programada · Web local (rama) · unitarias | router y aprobaciones | modelos de chat para propuestas/revisión | por solicitud | Propuestas multiagente sin prueba real | 6 |
| Fechas de ejecución | Programada · unitarias · APK build.5 compilada | avisos Android mediante alarmas inexactas, recepción tras reinicio | abrir app y autorizar; NO ejecución autónoma cerrada | local | aislamiento, fecha y no duplicación; pendiente ejecución Android | 6 |
| Workspace / entregables / archivos / favoritos | Programada · Web | Repo + AssetStore | proyecto | local | persistencia y movimiento real en Chromium | 7 |
| CSV/Excel, estadísticas, gráficos y escenarios de costos | Programada · Web · unitarias | XLSX y fórmulas locales | datos del usuario | local | CSV real: suma 100, media/mediana 25 | 7 |
| Ejecución autónoma cerrada, PC y conectores específicos cloud/Termius | Pendiente | — | módulos adicionales y permisos | — | — | 6–7 |
| embedding (memoria inteligente) | Programada · unitarias | OpenAI, Azure OpenAI | chat | Por token | Unitarias; sin operación real | 5 |

## Núcleo (Etapa 1)
| Componente | Estado |
|---|---|
| Registro de proveedores/modelos/capacidades + migración de proveedores existentes | Programada · Web · unitarias |
| Router exacto (manual / favorito / automático con razones) | Programada · Web · unitarias |
| Job Manager (8 estados, idempotencia, recovery_required) | Programada · unitarias |
| Archivo cifrado AES-256-GCM, DEK por archivo, nonce prefijo+contador, registro final | Programada · unitarias (manipulación, truncamiento, vacío, 8 MiB) |
| Llaves maestras versionadas + rotación | Programada · Web · unitarias |
| Plugin Android Keystore/StrongBox | Programada · compilada build.4/build.5; ejecución Android pendiente |
| Respaldo v2 Argon2id (PBKDF2 600 000 alternativo), restauración entre dispositivos | Programada · Web (exportación) · unitarias |
| Pantallas Modelos, Biblioteca, Trabajos, Diagnóstico, chat Automático/Favorito | Programada · Web |

## Alcance aún sin implementar (no sustituido por las pantallas nuevas)
- Voz conversacional bidireccional en tiempo real, interrupción y herramientas durante la conversación.
- Fase 6: ejecución de flujos con el proceso cerrado, agente PC y conectores específicos de nubes/Termius; cliente Git completo.
- Fase 7: predicciones con intervalos de incertidumbre y herramientas profesionales conectadas; los escenarios actuales son deterministas.
- Fase 8: extensión de composiciones, stems cuando el proveedor lo soporte, edición/mezcla/masterización y conversión de audio.
- Fase 9: editor de video con línea de tiempo, cortes/uniones/capas/transiciones, subtítulos y traducción, videos largos; CAD/modelado y edición 3D.
- Estas fases NO se declaran al 100%. Las credenciales y pruebas Android son bloqueos de validación adicionales, no explicación de los módulos sin implementar.
