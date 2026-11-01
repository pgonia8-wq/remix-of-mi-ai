# MI AI — Informe de pruebas

## Build.8 — 1-nov-2026: documentación y verificación de altas
- **Compilación:** Gradle BUILD SUCCESSFUL en 1m 38s, 204 tareas; com.miai.app, versionCode 8, Android mínimo 30/objetivo 35, SQLCipher ARM64/ARMv7/x86_64.
- **Firma comprobada:** certificado idéntico al APK build.7, SHA-256 48d18ad1491175c2bd8a248d59f2eed5be38fd8d08e7233d2df42fc4b5fa5acd. Archivo fijo del proyecto conservado tras reinicio. No recupera la firma de build.4.
- **SHA-256 APK:** fc92cad68837478ab956e91204e0356885dccd98fe3f96ac9be8a1dbdb7ac49d.
- **Pruebas automatizadas:** 184/184, 21 archivos; verificación vinculada a borrador exacto, rechazo de salida vacía, invalidación al cambiar clave/modelo/capacidad y mensaje sin eco de secretos.
- **Web:** Chromium comprobó Guardar bloqueado sin prueba para altas manuales, ElevenLabs y Tavily; sin errores JavaScript. No se usaron claves reales ni se simularon éxitos en la app.
- **Documentos:** manual de 13 páginas y catálogo de 6, todas renderizadas y revisadas sin recortes ni superposición. Archivo con contraseña estándar Debug, distinta de respaldos y API Keys.
- **Emulador/físico:** esta APK no se instaló/abrió aquí; cifrado, voz, SSH, alarmas y Media3 pendientes de ejecución Android. No hay cuentas/claves autorizadas para verificar operaciones externas nuevas.
- **Alcance:** persisten módulos ausentes del inventario (autonomía/PC/cloud/Git completo, profesional conectado/predicción, stems/mastering/extensión, video avanzado/CAD, Azure realtime/herramientas de voz). Alta manual solo admite capacidades con prueba mínima implementada; las demás requieren integración de verificación especializada. No se declara cierre 100%.

## Build.7 — 1-nov-2026: interfaz y editores, NO cierre 100%
- **Compilación realizada:** Gradle BUILD SUCCESSFUL, 37 s, 204 tareas. APK Debug com.miai.app 0.1.0-build.7, versionCode 7. Android 11+, SQLCipher ARM64/ARMv7/x86_64. Media3 plugin incluido en clases Java compiladas; firma Debug conserva certificado build.5/build.6.
- **SHA256:** efcbead3489d90e96b2d876e9c13b31e174c09b649142c0f48cd2c191298ab8f.
- **Programado:** menú lateral, chat a pantalla completa, markdown/código, copiar/valorar/editar/regenerar, archivos cifrados por proyecto; imágenes para OpenAI/Azure/Anthropic/Gemini. Audio PCM: recorte/fundidos/normalización/mezcla/WAV. Video Android Media3: recorte/unión/rotación/720p/subtítulos; SRT y traducción mediante chat. Voz WebRTC OpenAI con token efímero, interrupción y transcripciones; no ejecuta herramientas.
- **Pruebas automáticas:** 180/180 PASS, 20 archivos, ejecución limitada a dos workers. Una ejecución concurrente con compilación agotó 5 s en persistencia; repetición completa sin carga concurrente pasó. Contratos controlados no son verificación real de proveedores.
- **Web comprobada:** Chromium 1280×1800 y 360×626: menú, chat, adjunto TXT enviado efectivamente en solicitud controlada, respuesta markdown, copiar al portapapeles, valoración y adjunto conservados tras recarga. Sin errores JavaScript ni desbordamiento. Audio WAV real de 2 s recortado a 1 s y guardado cifrado en Biblioteca.
- **Corrección observada:** captura inmediata del FileList antes de limpiar el selector, evitando perder adjuntos por actualizaciones React diferidas; regresión añadida.
- **Emulador Android:** no ejecutado; no se instaló ni abrió esta APK. Video Media3, Keystore/SQLCipher, WebRTC/micrófono/SSH/avisos pendientes nativos.
- **Poco C40:** build.7 no probado. La confirmación anterior del usuario corresponde a build.3, no valida estos módulos.
- **Pendientes de implementación:** autonomía con app cerrada, agente PC/conectores cloud/Termius y Git completo; predicciones/herramientas profesionales conectadas; extensión musical/stems/masterización avanzada; capas/transiciones/video largo y CAD/edición 3D; herramientas durante voz/Azure realtime. No son solo bloqueos por credenciales.
- **Firma:** compatible con build.5/build.6, distinta de build.4 y no demostrada compatible con build.3. No desinstalar para resolver conflictos: primero copia cifrada; conservar clave original para actualización sin pérdida.
- **Proveedores reales:** nuevas operaciones no verificadas con credenciales. No se declara producto completo ni seguridad auditada al 100%.

## Compilaciones build.5 y avance build.6 — 31-oct-2026
- **No es una entrega 100%:** el alcance maestro conserva módulos pendientes en el inventario; las pantallas de medios no sustituyen edición avanzada, ejecución autónoma, PC ni CAD.
- **Build.5 compilada realmente:** Gradle `assembleDebug`, BUILD SUCCESSFUL, 204 tareas. Incluye las ampliaciones de Fases 6–7, JSch/MiaiRemote y nuevos avisos Android de programación (alarmas inexactas, recepción tras reinicio, permiso de notificaciones). Los avisos no ejecutan solicitudes ni acciones automáticamente; requieren abrir y autorizar.
- **APK verificada:** com.miai.app, versionCode 5, versionName 0.1.0-build.5, minSdk 30, targetSdk 35; libsqlcipher.so ARM64 y ARMv7, además x86_64; firma Debug válida. SHA256: 4e81e39b296923d5d7dce2c7c209d3ff332e74bb911aaf02b923bb201ffc2340.
- **Build.6 compilada realmente:** Gradle BUILD SUCCESSFUL en 31 s; 204 tareas (57 ejecutadas, 147 actualizadas). Incluye todos los módulos actuales y las nuevas pantallas/adaptadores de música, video y 3D. versionCode 6, versionName 0.1.0-build.6; minSdk 30, targetSdk 35; SQLCipher ARM64/ARMv7/x86_64, allowBackup=false y permisos/receiver de avisos comprobados. Firma Debug válida, mismo certificado que build.5. SHA256: c437013ecc2fe3cb020996d0e3f14dc71aec5f169592bb7b81fb84fe42f14d3f. No se presenta como APK final al 100%.
- **Firma incompatible comprobada:** certificado build.5 SHA256 48d18ad1491175c2bd8a248d59f2eed5be38fd8d08e7233d2df42fc4b5fa5acd, distinto de build.4 bf963a1dabd22e7c5e98403546c82d3319eb5ffba6c14b3029c1f39ffcc07ab3. No se recomienda desinstalar: primero copia cifrada; actualizar sin desinstalar requiere la clave original.
- **Medios programados:** ElevenLabs música/efectos; Runway texto/imagen/video a video; Meshy texto/imagen a GLB; consulta y recuperación sin volver a generar; descarga de resultados sin Authorization/cookies, rechazo de redirecciones; archivo/versiones/licencia cifrados. Guardado de nuevos proveedores de medios exige recibir un resultado real; una tarea aceptada sola no habilita Guardar.
- **Pruebas automáticas:** 164/164 PASS en 16 archivos. Incluyen API musical distinta de TTS, respuesta inválida, selección de contratos de video, descargas sin secretos, recuperación de ID remoto sin reenvío y aislamiento de programación. Respuestas controladas son pruebas de contrato, NO conexiones reales con proveedores.
- **Web real:** Chromium, proyecto creado desde UI; pantallas medios y formulario de clave vacía con guardar/probar bloqueados; 360×626 sin desbordamiento; GLB local importado mediante UI, almacenado cifrado, visible en Three.js, rotación interactiva, reapertura tras recarga y visor a 1280×1800. Sin errores JavaScript. No se hicieron llamadas de generación con claves del usuario.
- **Emulador:** no se inició por ausencia de KVM, evitando repetir la espera previa. No se instaló ni abrió el APK; SQLCipher/Keystore/SSH/SFTP/avisos/micrófono/worker pendientes de ejecución Android.
- **Dispositivo físico:** conserva la confirmación del usuario para build.3; build.5/build.6 no probadas en Poco C40. Inclusión de ABI no acredita funcionamiento ARM real.
- **Dependencias:** análisis automático detectó vulnerabilidades preexistentes en XLSX/Zod y dependencias transitivas del framework; no se declara auditoría de seguridad superada ni aplicación final segura al 100%.


## Ampliación Fases 6–7 — 31-oct-2026 (posterior a build.4)
- **Programado:** ramas y dependencias, ejecución hasta aprobación, propuesta de delegación al equipo, revisión de conflictos sin aplicación automática, fechas revisadas con la app abierta; CodeMirror con resaltado/autocompletado y diferencias; módulo SSH/SFTP Android con JSch, clave de host confiada y confirmación nativa por operación; comandos Git remotos revisados, apertura de Termux; lectura/actualización de archivos GitHub con verificación de identidad y tokens cifrados excluidos de copias.
- **Fase 7 programada:** Workspace unificado con archivos cifrados, búsqueda, favoritos y entregables/estados; lectura CSV/Excel local, estadísticas descriptivas, gráfico de primeros 20 valores, anomalías por 3 desviaciones, escenarios de costos/punto de equilibrio e informes cifrados. No se presentan escenarios como predicciones ni asesoramiento profesional.
- **Web probado:** Chromium, escritorio 1280×1800 y teléfono 360×627: guardar entregable, mover a revisión y leer estado tras recarga; CSV real [10,20,30,40] → suma 100, media y mediana 25; guardar informe en Biblioteca; editor CodeMirror → JavaScript real produce `Motor real` y `42`; flujo local con rama final y aprobación → completed. Pantallas Workspace/datos/SSH/GitHub/editor sin desbordamiento horizontal ni errores JavaScript.
- **Pruebas automáticas:** 156 pruebas pasaron antes de añadir dos contratos adicionales de GitHub; la ejecución final se indica en el resultado del turno. Las pruebas con respuestas controladas no acreditan conexiones externas.
- **Compilación:** estas ampliaciones NO están en APK build.4. No se compiló una nueva APK en este turno. MiaiRemote/JSch no compilados ni probados nativamente.
- **Emulador y físico:** ninguna prueba de las ampliaciones. SQLCipher/Keystore y comandos SSH/SFTP/Termux siguen pendientes en Android. No se dispone de servidor/cuenta/credenciales para probar GitHub, propuestas multiagente o revisión de conflictos reales.
- **Pendiente de implementación, no solo validación:** ejecución autónoma con app cerrada, disparadores Android, agente PC, conectores específicos de cloud/Termius. La programación actual requiere abrir la app y autorizar; la integración Termux abre la aplicación separada y no es un puente de ejecución local. Git remoto depende de herramientas y credenciales del servidor; GitHub actual usa archivos/commits, no un cliente Git completo. Ambas fases no se declaran totalmente finalizadas.
- **Firma y datos:** conservar copia cifrada antes de una futura APK; no desinstalar la existente para resolver conflictos de firma.

## Entrega actual: build.4 — 31-oct-2026
- **Programado:** Fases 1–5 y entrega parcial de la nueva Fase 6 (antes 8). Agentes configurables por proyecto, herramientas autorizadas, selección de modelo por capacidad, permiso explícito para memoria, límites de solicitudes; flujos editables y propuestas IA, secuencias, condición sobre resultado anterior, repeticiones 1–3, aprobación humana, historial, activación y cancelación entre pasos. Ejecución de un paso por acción del usuario; no se presenta como autonomía completa.
- **Código:** JavaScript síncrono real en QuickJS WASM dentro de un worker; sin DOM, red, almacenamiento, módulos ni puente Capacitor. Límites del runtime: 16 MiB de memoria QuickJS (no representa todo el consumo WASM), pila 256 KiB, ejecución 1,5 segundos; fuente 60 000 caracteres, salida 16 000. Worker terminado al cancelar o tras 10 segundos incluyendo carga. Archivos cifrados con versiones; propuestas de generación/refactor/pruebas/documentación requieren un modelo de chat y no se ejecutan automáticamente.
- **Compilación realizada:** `assembleDebug`, Gradle BUILD SUCCESSFUL, 204 tareas; APK `com.miai.app`, versionName 0.1.0-build.4, versionCode 4. Android SDK 35 / JDK 21. Firma Debug verificada. MinSdk 30 y SQLCipher ARM64, ARMv7 y x86_64 comprobados dentro del APK. Plugin Keystore compilado; no ejecutado aquí. No se generó Release en esta entrega.
- **Pruebas automáticas:** 148/148 PASS en 14 archivos Vitest/sql.js/QuickJS; incluye 11 nuevas pruebas sobre aislamiento de agentes/proyectos, aprobación forzada, permisos de herramientas, recuperación sin repetición automática, formatos y límites, respaldo/borrado, variables y motor JavaScript.
- **Probado en web:** Chromium 1280×1800 y 360×627: crear agente, guardar y recargar; crear flujo local, solicitar aprobación, aprobar, comprobar nota desde Notas; ejecutar `console.log(input); 2 + 2` con salida real `Prueba real` y `4`; guardar código cifrado y recuperar tras recarga. Sin errores JavaScript y sin desbordamiento horizontal. Los éxitos locales no simulan éxitos de proveedores.
- **Probado en emulador Android:** ninguna prueba realizada en build.4. No se lanzó el emulador sin aceleración para evitar repetir la espera anterior. Instalación, apertura, SQLCipher, Keystore, micrófono, archivos, copia entre dispositivos y worker de código pendientes en Android.
- **Probado en dispositivo físico:** el usuario confirmó build.3 en Poco C40 (abre, chat y proveedor funcionan y persisten). No hay confirmación de build.4. Bibliotecas incluidas no acreditan ejecución real ARM64/ARMv7.
- **Pendiente con proveedores:** agentes/modelos, planificación con IA, generación y herramientas externas reales no probados con credenciales del usuario.
- **Alcance de Fase 6 aún pendiente:** terminal/Termux/Termius, SSH/SFTP, Git/GitHub, cloud externo, programación Android, disparadores automáticos, ramas generales, delegación autónoma y resolución de conflictos. No se anuncia la fase completa ni un entorno de ingeniería completo.
- **Instalación:** no desinstalar build.3 para solucionar un posible conflicto de firma: borraría los datos. No se ha comprobado que la firma Debug actual coincida con la de build.3; conservar una copia cifrada antes de probar la actualización.

---

# Histórico: Fase 1 — compilación 0.1.0-build.3

## Entrega actual — 31-oct-2026, 20:19 UTC
- **Compilación realizada:** Debug 0.1.0-build.3 y Release sin firma, Gradle BUILD SUCCESSFUL (472 tareas). Incluyen Azure OpenAI, validación real previa al guardado, correcciones de chat y persistencia de vista previa. Preparación y compilación ejecutadas en copia aislada con JDK 21 y Android SDK 35.
- **APK comprobado:** firma Debug v2 válida; minSdk 30 (Android 11), targetSdk 35; SQLCipher incluido para arm64-v8a, armeabi-v7a y x86_64; allowBackup=false en Debug y Release; enlace selftest únicamente en Debug. Incluir bibliotecas no demuestra funcionamiento ARM en dispositivo.
- **SHA-256 Debug:** `6c6cb3b9f14472dd2669c00d7317c457865ce5b6563c834d6f83d2cdf1a71c5c`.
- **Pruebas automáticas actuales:** 50/50 PASS en Vitest/sql.js. La nueva autoprueba de recuperación utiliza cifrado por contraseña, rechazo de contraseña incorrecta, eliminación del proyecto y comparación de todos sus registros restaurados. Añade conversaciones, memoria con dos versiones y documento de texto; no acredita recuperación de archivos adjuntos binarios.
- **Programado para Android:** la autoprueba nativa ahora ejecuta esa recuperación y el informe del emulador requiere su señal específica. Sus resultados todavía no se han obtenido en Android. Los errores de autoprueba no imprimen mensajes de excepción ni credenciales.
- **Probado en entorno web:** pruebas automáticas actuales y las comprobaciones Chromium descritas abajo; no se repitió generación real con Azure en esta ejecución. El usuario confirmó previamente que su modelo y chat funcionan en vista previa.
- **Probado en emulador Android:** ninguna prueba superada en esta entrega. Se instaló el emulador API 30 y se intentó arrancar sin KVM; no se obtuvo arranque completo antes del límite de 600 segundos. No fue posible instalar ni abrir el APK: permanecen pendientes, al igual que SQLCipher y Keystore en ejecución nativa.
- **Probado en dispositivo físico:** ninguna prueba realizada. Pendiente Poco C40: instalación/apertura, persistencia, Azure y streaming, documentos sin Internet, exportación/importación y seguridad nativa. ARMv7 pendiente de ejecución real.
- **Bloqueos externos:** conexión GitHub para ejecutar Actions en un entorno con KVM; clave propia de firma Release; pruebas en el teléfono. No se creó backend obligatorio ni se cambiaron SQLCipher o Keystore. Release sin firma no es instalable ni se considera versión final.

Las secciones siguientes son históricas; sus estados pendientes describen cada entrega anterior, no sustituyen los resultados anteriores de build.3.

## Guardado en vista previa — 31-oct-2026, 19:57 UTC
- El usuario confirmó que el modelo vuelve a aparecer y el chat funciona. La desaparición inicial no quedó reproducida en su sesión; estaba consultando una versión histórica según el contexto recibido.
- Se detectó y reprodujo separadamente una ventana de pérdida al recargar: sql.js demoraba 150 ms la escritura después de resolver el guardado. Se eliminó esa demora solo para la vista previa; los errores de escritura ahora rechazan la operación. SQLCipher y Keystore nativos permanecen intactos.
- **49/49 pruebas automáticas PASS:** la nueva regresión falla antes y pasa después, verificando proveedor Azure, clave cifrada y estado persistidos antes de resolver el guardado. Estado verificado solo como dato de prueba de repositorio, no como conexión simulada en la app.
- **Chromium:** proveedor de prueba no verificado permanece tras recarga inmediata y navegación Proyectos → Ajustes, cero errores JavaScript. No se usaron credenciales del usuario ni se simuló generación.
- Pendiente recompilar y comprobar esta actualización en Android. Los datos de la vista previa pertenecen a su origen; cambiar de dirección de vista previa no transfiere datos entre ellas.

## Corrección: destroy is not a function — 31-oct-2026, 19:52 UTC
- **Causa confirmada en el navegador del usuario:** `scrollIntoView()` devuelve una Promise en ese entorno. El efecto del chat devolvía implícitamente ese resultado; React lo trataba como función de limpieza al actualizar mensajes o desmontar y fallaba. Se cambió a un cuerpo de bloque sin retorno. No es un fallo del proveedor Azure ni del registro de rutas.
- **Prueba de regresión:** se reproduce el retorno Promise observado; la prueba falla antes de la corrección y pasa después al actualizar mensajes y desmontar el chat. 48/48 pruebas automáticas PASS.
- **Probado en Chromium:** crear proyecto → abrir chat nuevo → salir → reabrir chat existente → Ajustes, con retorno Promise del desplazamiento; cero errores JavaScript y sin pantalla en blanco.
- **Android:** corrección programada, no recompilada ni probada en emulador o dispositivo físico; el APK anterior no la incluye.

## Actualización: Azure OpenAI — 31-oct-2026
- **Corrección Azure v1 (19:49 UTC):** rechazo reproducido y corregido para la URL `https://pgonia8-4510-resource.services.ai.azure.com/openai/v1/chat/completions`. Ambos proveedores Azure reconocen `/openai/v1` y la URL completa; v1 envía deployment como `model` en el cuerpo, sin ruta legacy ni versión fechada. La versión puede dejarse vacía para v1; sigue siendo requerida para Azure OpenAI legacy.
- **Verificación v1:** 47/47 pruebas automáticas PASS, incluidas cinco regresiones que fallaban antes. En Chromium se envió una solicitud real a la URL exacta con una clave ficticia inválida: Azure devolvió HTTP 401 y se mostró el diagnóstico de API Key inválida, no rechazo de URL; guardado bloqueado y cero errores JavaScript. No se probó generación con una clave válida ni Android.
- **Programado:** proveedor Azure OpenAI separado, con únicamente URL, API Key, deployment y versión; nombre/modelo internos derivados del deployment, sin pedir JSON. Solicitud con `api-key`: deployment en ruta y versión en query para legacy; deployment como `model` en cuerpo para v1. Admite URL del recurso, URL completa de deployment y `/openai/v1/chat/completions`; los campos explícitos de deployment/versión prevalecen en legacy. Las llamadas siguen en el dispositivo.
- **Causa posible identificada, no confirmada para la solicitud del usuario:** antes se rechazaban URLs con `?api-version` y se duplicaba la ruta al pegar una URL completa. No se dispone de la URL ni de la respuesta HTTP de su intento para establecer su causa exacta.
- **Probado en Chromium, 1280×1800 y 360×627:** cuatro campos, ausencia de modelo/JSON, diagnóstico de credencial faltante, guardado bloqueado, sin errores JavaScript ni desbordamiento horizontal.
- **Pruebas unitarias:** solicitudes con URL raíz/completa, campos obligatorios, encabezados, cuerpo sin modelo/JSON, errores de red y persistencia/restauración sin claves; respuestas controladas solo en pruebas, nunca para simular éxito en la app.
- **Pendiente:** respuesta real de Azure con credenciales autorizadas; compilación de esta actualización; emulador Android y Poco C40. Sin respuesta HTTP no se puede distinguir CORS, red o restricciones del recurso. El APK anterior no incluye Azure OpenAI.

## Actualización: chat y validación de modelos — 31-oct-2026
- Causa confirmada del fallo de la vista previa: sql.js selecciona `sql-wasm-browser.js` y solicita `/wasm/sql-wasm-browser.wasm`; solo existía el archivo `sql-wasm.wasm`. Las peticiones devolvían 404 y la inicialización abortaba. No se encontró evidencia de un fallo de montaje o de registro de la ruta del chat. Se añadió el binario browser exacto de la dependencia y una prueba de regresión.
- **Programado:** Probar conexión en formulario; Guardar modelo solo tras respuesta real válida; invalidación al cambiar campos; solicitudes específicas por proveedor; timeout 20 s; diagnóstico sanitizado; estados persistentes, repetición de pruebas y actualización del estado tras fallos en chat. Las credenciales de borrador no se escriben en almacenamiento.
- **Probado en navegador Chromium:** creación de proyecto, entrada a chat nuevo, reapertura mediante recarga del chat existente, sin errores JavaScript; formulario con guardado bloqueado, dirección mal formada, endpoint real que devuelve 404 y fallo real de red. Verificado en 360×627 y 1280×1800, sin desbordamiento horizontal en el formulario.
- **Pruebas automáticas:** 32/32 PASS en Vitest/sql.js: 21 contratos de proveedores y diagnóstico, 8 repositorio/cifrado/aislamiento/estado, 2 rutas, 1 archivo WebAssembly. Los contratos de proveedores usan respuestas controladas exclusivamente como pruebas unitarias; NO acreditan conexiones reales exitosas.
- **Pendiente con proveedores reales:** credencial válida y generación efectiva; API Key incorrecta contra proveedor real; modelo inexistente contra proveedor real; timeout de proveedor real. No había credenciales autorizadas disponibles. No se simuló una conexión exitosa en la aplicación.
- **Android:** esta actualización no se ha compilado ni ejecutado en emulador o dispositivo físico. El APK build.2 anterior NO contiene estos cambios. El fallo WebAssembly pertenece a la rama web; Android usa SQLCipher y no depende de ese archivo. La validación de proveedores sí se comparte con Android y requiere comprobarse allí. No se modificaron SQLCipher, Keystore ni la configuración de seguridad nativa.

El resto del informe corresponde a la compilación anterior y no acredita estas mejoras.

## 1. Compilación realizada (entorno de Lovable, Linux, JDK 21, Android SDK 35)
| Elemento | Resultado |
|---|---|
| Interfaz prerenderizada para el APK | OK |
| Proyecto Android Capacitor generado y sincronizado (4 plugins nativos) | OK |
| `assembleDebug` → app-debug.apk (28 MB) | OK |
| `assembleRelease` → app-release-unsigned.apk (sin firma, falta tu clave) | OK |
| libsqlcipher.so en arm64-v8a y armeabi-v7a | OK |
| minSdkVersion 30 (Android 11) / target 35 | OK |
| allowBackup=false; enlace de autoprueba solo en Debug | OK |

## 2. Pruebas automáticas superadas — entorno: Node/Vitest con sql.js (misma lógica y SQL que en Android, sin SQLCipher)
| Prueba | Resultado |
|---|---|
| Aislamiento: chats, mensajes, memoria, documentos, búsqueda y contexto enviado a la IA de otro proyecto → vacío | PASS |
| Escribir en un chat de otro proyecto → error | PASS |
| Chats del mismo proyecto comparten memoria | PASS |
| Memoria versionada sin tocar las conversaciones | PASS |
| API key cifrada en la base, recuperable y ausente en la exportación | PASS |
| Exportación cifrada: contraseña incorrecta rechazada, sin texto legible | PASS |
| Exportar/importar un proyecto completo (chats, memoria con versiones, documentos) | PASS |

Vista previa web (navegador, 360 px): crear proyecto → chat → memoria → recargar → los datos siguen ahí. PASS.

## 3. Pruebas en emulador Android 11 — PENDIENTES (se ejecutan en GitHub Actions)
Este entorno no tiene virtualización (KVM), así que aquí no puede arrancar un emulador. `scripts/emulator-test.sh` corre en GitHub Actions en cada push y comprueba: instalación, apertura, creación de datos, persistencia tras cerrar y reabrir, aislamiento, descifrado de la API key vía Keystore, archivo de base cifrado (sin texto ni cabecera SQLite) y que la API key no aparece en la base, preferencias ni logcat. Se ejecuta en cuanto conectes GitHub; el informe queda como artefacto de cada ejecución.

## 4. Pendiente en tu Poco C40 (ARM64, físico)
- Instalar el APK y abrir la app.
- Crear proyecto, chat y memoria; cerrar la app y volver a abrirla.
- Añadir un proveedor real, probarlo y conversar con streaming; cambiar de modelo a mitad del chat.
- Subir un documento y buscarlo; usarlo sin Internet.
- Exportar una copia, borrar el proyecto e importarla.
- ARMv7 en ejecución real: no hay dispositivo de 32 bits disponible; solo se verifica que la librería está incluida.
