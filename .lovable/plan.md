# Plan: cerrar todo lo pendiente de la auditoría

Objetivo: corregir los fallos encontrados, dejar la app lista para Google Play (versión gratuita) y compilar la build.23. La PWA y las suscripciones quedan para después porque son proyectos nuevos, no arreglos.

## Lote 1 — Pérdida de datos (primero)
- Respaldos y exportación incluyen todo: configuración de cada conversación (contexto), estado de respuestas interrumpidas, ejecuciones autónomas y archivos del espacio de trabajo del teléfono.
- Duplicar proyecto copia también esa configuración y se hace "todo o nada": si algo falla, no queda una copia a medias.

## Lote 2 — Chat, agentes y modelos conectados
- El chat manual usa las mismas comprobaciones de compatibilidad que el selector automático.
- Cada llamada de una conversación con herramientas se registra en costos por separado.
- Delegar desde el chat a los autónomos transmite el equipo elegido (teléfono, PC o VM) y el modelo coordinador.
- Videos, música y 3D lentos se enlazan al mensaje que los pidió cuando terminan.
- Regenerar no pierde archivos ni agentes ya creados.
- Llegar al límite de turnos marca "requiere intervención", nunca "terminado".
- Las herramientas que agotan su tiempo se detienen de verdad.

## Lote 3 — Seguridad
- Bloquear redirecciones hacia la red local en solicitudes web.
- Filtrar claves y datos secretos de registros y diagnósticos.
- Actualizar dependencias con avisos altos (16 avisos detectados).

## Lote 4 — Requisitos de Google Play
- Botón "Reportar contenido" en respuestas de IA.
- Pantallas de privacidad, términos, soporte/contacto y versión visible.
- Ocultar video de Cosmos hasta tener su dirección real; Cosmos sigue en chat.
- Registro local de fallos (sin enviar datos a ningún servidor), exportable por el usuario.

## Lote 5 — Compilación
- Android 36 como objetivo, ofuscación activada, número de versión que nunca retrocede.
- Generar AAB para Play además de la APK. La firma de producción necesita que tú crees y guardes la clave permanente; sin ella entrego solo la APK de prueba firmada como siempre.
- Compilar build.23.

## Verificación
- Una prueba automática por cada fallo corregido, más la suite completa (hoy 463).
- Revisión en la vista previa de respaldo/restauración, duplicado y reportar contenido.
- No probable desde aquí: teléfono real, tus cuentas Azure y Play Console; lo indicaré claramente.

## Detalles técnicos
- Repo: añadir `chat_settings`, `message_status`, `auto_runs`, `local_ws_files` al dump/restore v3 y a duplicateProject dentro de una transacción con rollback.
- `invokeTool()`: AbortSignal real en timeout; chat-tools registra costo por turno.
- `agents.delegate`: pasar `environment` y `roleChoices` al builder.
- Jobs remotos: guardar message_id de origen y enlazar al completar en el poller global.
- Orquestador: `maxTurns` alcanzado → estado `needs_review`.
- fetch seguro: validar cada salto de redirección contra rangos privados.
- `scripts/android-prepare.sh`: targetSdk 36, minify, versionCode desde contador persistente, tarea bundleRelease.
