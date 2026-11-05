# Que la respuesta del modelo no se pierda al bloquear o cerrar la app

## Qué pasa hoy (confirmado en el código)
- Lo que el modelo va escribiendo solo vive en pantalla; se guarda **hasta que termina** la respuesta.
- Si la conexión se corta a mitad (por ejemplo, al bloquear la pantalla Android pausa la app), el texto de esa parte tampoco se guarda: solo se conserva lo de pasos anteriores.
- Si Android cierra la app, se pierde todo.

## Qué cambiará
1. **Guardado continuo**: la respuesta se guarda cifrada mientras se escribe (cada ~1,5 s y al instante cuando bloqueas la pantalla o sales de la app). Al volver, ves todo lo escrito hasta ese momento.
2. **Sigue escribiendo con la pantalla bloqueada**: mientras el modelo responde, aparece una notificación "MI AI está respondiendo…" (la misma que ya usan los agentes) para que Android no pause la conexión. Desaparece al terminar.
3. **Respuesta interrumpida con botón "Continuar"**: si aun así se corta (sin internet, Android cerró la app), el mensaje queda marcado "Interrumpida" con un botón **Continuar** que pide al modelo seguir justo donde quedó, sin repetir lo ya escrito. También **Regenerar**.
4. Nada se pierde en silencio: si el guardado falla, aparece aviso.

## Cómo lo comprobaré
- Pruebas automáticas: respuesta cortada a mitad queda guardada; recargar la app muestra el texto parcial; "Continuar" envía el texto previo y une la continuación en el mismo mensaje; los chats de otros proyectos no se tocan.
- En vista previa: simular salir de la app durante una respuesta y recargar.
- No puedo probar el bloqueo real de pantalla en tu teléfono; queda para la build.23.

## Detalles técnicos
- `src/routes/chat.$chatId.tsx`: crear el mensaje assistant al primer token (`repo.addMessage` con estado `streaming`), `repo.updateMessage` con `out + turnText` limitado a 1 escritura/1,5 s y forzada en `visibilitychange`/`pagehide` y `App.addListener('pause')`; al finalizar, actualizar en vez de insertar; quitar el insert duplicado del `finally`.
- Nueva columna `status` (`streaming|done|interrupted`) en mensajes vía migración del esquema SQL de Repo; al abrir el chat, cualquier `streaming` huérfano pasa a `interrupted`.
- Foreground service: reutilizar el aviso de agentes de `src/lib/device.ts` con texto de chat, iniciado/parado alrededor de `streamChat`.
- "Continuar": reenviar historial + parcial como assistant y petición de continuar; concatenar al mismo mensaje. Reasoning y adjuntos se mantienen ligados al mismo ID.
