# MI AI — Roadmap

## Bloque 1 — seguridad y núcleo (en curso)
- [x] Archivar, restaurar y duplicar proyectos.
- [x] Exportar/importar un solo proyecto cifrado (siempre como proyecto nuevo; contraseña errónea no crea nada).
- [x] Presupuesto mensual por proyecto y registro de costos (aviso 80%, bloqueo 100%, marca de estimados).
- [ ] Conectar el registro de costos y el bloqueo de presupuesto a cada llamada de proveedor, con confirmación manual.
- [ ] Respaldos por partes (memoria acotada) con verificación previa.
- [ ] Restauración y rotación de llaves reanudables (journal).
- [ ] Riesgos R01–R20 reproducibles.

## Solicitud actual — corregir auditoría, Azure multimarca y búsqueda abierta
- [x] Añadir SearXNG como búsqueda abierta prioritaria (instancia HTTPS/JSON explícita, sin claves); verificación/guardado/recarga comprobados con respuesta controlada. Instancia real pendiente.
- [x] Azure por defecto y prioridad automática para capacidades verificadas; otros proveedores opcionales conservados y registro filtrado por adaptador ejecutable.
- [x] Azure Sora 2 v1 texto a video: multipart, IDs persistentes, consulta y descarga same-origin sin redirecciones, prueba durable con recuperación tras recarga; contratos controlados y 215 pruebas, sin generación real.
- [x] Corregir API pública de descifrado: validar el archivo completo antes de entregar plaintext, fijar relecturas por hash y rechazar cambio entre pasadas; regresiones de integridad.
- [ ] Azure multimarca restante: contratos específicos para voz realtime, música, 3D y referencias de video; no se habilitan por cambiar el nombre de proveedor.
- [ ] Corregir y construir el resto del alcance auditado, conservando los pendientes hasta su implementación y validación efectiva.
- [ ] Validación real Azure multimarca y Android: requiere deployments autorizados y dispositivo; no declarar cobertura universal por registrar modelos.

## Solicitud actual — recuperación y auditoría del Prompt Maestro
- [x] Recuperar el Prompt Maestro original y las seis ampliaciones adjuntas sin sustituirlas por resúmenes.
- [x] Entregar un único TXT con el original y seis ampliaciones íntegros (3.581 líneas de fuentes), más auditoría con 166 brechas agrupadas y 20 riesgos técnicos referenciados.
- [x] Iniciar corrección de compatibilidad: adaptador ejecutable, formatos/tamaños/parámetros declarados, contexto conocido y disponibilidad revalidada antes de claves/trabajos/red; 10 regresiones nuevas, sin APK ni cierre total.
- La auditoría es revisión estática amplia, no certificación de exhaustividad o pruebas nativas; no convierte riesgos no reproducidos en incidentes confirmados.

## Solicitud actual — documentación, firma y cierre
- [x] Entregar archivo de contraseña de firma Debug y distinguirlo de la contraseña personal de respaldos.
- [x] Entregar manual de configuración de proveedores, capacidades, herramientas y agentes (13 páginas revisadas).
- [x] Entregar catálogo de herramientas con soluciones, requisitos y límites reales (6 páginas revisadas).
- [x] Cerrar el guardado sin verificación en altas manuales de modelos, ElevenLabs y Tavily; 184 pruebas y bloqueo de tres formularios en Chromium.
- [x] Compilar APK build.8 con la firma conservada; certificado idéntico a build.7, Android 11+, SQLCipher ARM64/ARMv7.
- [ ] Cierre total del alcance maestro: pendientes funcionales explícitos en el inventario; no equivale a generar una APK.

## Solicitud actual — cierre completo y experiencia premium
- [x] Menú lateral hamburguesa con chats/proyectos/biblioteca/herramientas/configuración, navegación limpia sin barra inferior.
- [x] Chat amplio, acciones por mensaje, composición cómoda y adjuntos cifrados con envío multimodal compatible; web verificada con contrato controlado.
- [ ] Completar todas las funciones aún pendientes del alcance maestro; NO sustituir el cierre por una compilación parcial.
- [x] Compilar APK renovada build.7 y verificar firma/ABI/SDK; NO es cierre final del alcance.

## Solicitud actual — cierre y dos entregas APK
- [x] Auditar el alcance aprobado de Fases 6–7 y documentar cada requisito pendiente.
- [ ] Completar los módulos implementables de Fases 6–7 y probarlos; no declarar 100% mientras existan bloqueos.
- [x] Compilar y entregar APK build.5 con Fases 6–7 actualizadas e informe, sin declaración 100%.
- [ ] Completar Fases 8 (música) y 9 (video/3D) según el alcance aprobado, sin sustituir APIs reales por simulaciones.
- [ ] Compilar y entregar APK final cuando el alcance y las verificaciones estén cerrados.

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
- [x] APK del núcleo y ampliaciones compilada e informe por niveles; validación nativa pendiente.
- [ ] Bloqueado: operaciones reales Azure imagen/audio/video (deployments y claves autorizados del usuario)
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
- [x] Ampliación Fase 6: ramas, dependencias, ejecución hasta aprobación, delegación propuesta al equipo, revisión de conflictos, programación manual por fecha
- [x] Desarrollo: editor CodeMirror, resaltado/autocompletado, comparación de cambios; SSH/SFTP Android con confirmación nativa y host confiable; Git remoto por comandos revisados; archivos GitHub por API con token cifrado
- [x] Fase 7 local: espacio profesional, búsqueda/favoritos, archivos cifrados, entregables por estado, CSV/Excel, estadísticas/gráfico local, escenarios de costos e informes
- [x] Fase 6 (antes 8), entrega parcial: agentes por proyecto, secuencias revisadas, condiciones de texto, repeticiones limitadas, historial, aprobación, límites y JavaScript aislado
- [x] Compilar APK build.4 con Fases 1–5 y la entrega parcial de Fase 6; comprobar firma, minSdk y ABI
- [ ] Fase 6 pendiente: ejecución autónoma en segundo plano/disparadores Android, PC y conectores específicos de nubes/Termius (no implementados; requieren módulos externos, no solo credenciales)
- [ ] Bloqueado: comprobar SSH/SFTP/Termux en Android, GitHub y revisión multiagente con cuentas/servidor reales (entornos y credenciales no disponibles)
- [x] Compilar las ampliaciones de Fase 6–7 en build.5 y build.6; build.4 NO las incluye.
- [ ] Bloqueado: validar APK build.4, SQLCipher/Keystore y JavaScript en Android/Poco C40 (sin teléfono ni emulador acelerado disponible)
- [ ] Bloqueado: pruebas reales con claves del usuario (Azure, Tavily, ElevenLabs)

## Orden pendiente solicitado
- Fase 7 (antes 9): espacio profesional
- Fase 8 (antes 7): música
- Fase 9 (antes 6): video y 3D

## Avance actual Fases 8–9 (parcial, no cierre)
- [x] Compilar y entregar build.6 con todos los módulos implementados actuales; NO es la APK final con alcance 100%.
- [x] Música y efectos ElevenLabs por APIs independientes de TTS, biblioteca/versiones y licencia registrada sin promesa comercial.
- [x] Runway texto/imagen/video a video y Meshy texto/imagen a GLB con IDs remotos persistentes, consulta sin reenvío y descarga sin credenciales.
- [x] Importar archivo cifrado y visor GLB real: girar, reapertura después de recarga, escritorio y 360 px.
- [x] Pantallas Música, Video y Modelos 3D; prueba real previa al guardado de nuevos proveedores de medios.
- [x] Editor PCM local: recorte, fundidos, normalización, mezcla hasta cuatro pistas y WAV; web comprobada.
- [ ] Extensión/stems/masterización avanzada/conversión adicional de audio: implementación pendiente.
- [x] Editor Android Media3 compilado: recorte/unión/rotación, formato 720p, subtítulos; SRT y traducción por chat programados. Ejecución Android pendiente.
- [ ] Capas/transiciones generales y medios largos: implementación pendiente.
- [ ] CAD/modelado/edición 3D.
- [x] Voz WebRTC OpenAI programada: token efímero, interrupción, silencio, transcripciones y guardado; contratos unitarios, sin sesión real comprobada.
- [ ] Herramientas durante voz y voz Azure en tiempo real: implementación pendiente.
- [x] Firma fija conservada y build.8 compatible en certificado con build.7; no se recuperó la firma de build.4. Actualización física pendiente.
- [ ] Validación nativa y proveedores reales: no hay dispositivo/servidor/cuentas/claves autorizados disponibles.

## Fase 1 (completada)
- [x] Proyectos, chats, memoria, documentos, proveedores con prueba real, Azure OpenAI, respaldo cifrado, APK build.3
- [x] Probado por el usuario en Poco C40: APK abre, chat funciona, proveedor persiste

## Cierre de auditoría (plan aprobado 2026-11-01)
- [x] Bloque 1: archivar/duplicar proyectos (probado en web y pruebas)
- [ ] Bloque 1: respaldo por bloques, rotación reanudable, costos/presupuestos, exportar un proyecto, riesgos R01–R20
- [ ] Bloques 2–3: medios, documentos, investigación, datos
- [ ] Bloque 4: sistema autónomo (ReAct, Tool Manager, multiagente, AI Builder)
- [ ] Bloque 5: APK final
