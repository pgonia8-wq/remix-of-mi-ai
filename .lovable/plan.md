# Bloque 4 — Sistema autónomo completo

Objetivo: pasar del agente adaptativo secuencial actual a un sistema autónomo supervisado completo, sin cambiar la arquitectura (Android, local, claves propias, Repo por proyecto, sin servidor obligatorio). Se trabaja seguido hasta cerrarlo; la APK sigue en el bloque 5.

## Qué podrá hacer Fer al terminar
- Dar un objetivo a un equipo de agentes y verlo trabajar en vivo: plan, pasos, herramientas usadas, costo acumulado y resultado revisado.
- Aprobar o rechazar cada acción sensible (gasto, red, archivos, SSH, GitHub) desde una sola pantalla.
- Pausar, reanudar después de cerrar la app y detener cualquier ejecución sin repetir cobros.
- Usar el "AI Builder": describir una mini app o herramienta y recibir código ejecutable en el sandbox, probado y guardado como entregable del proyecto.
- Recibir recordatorios programados que abren la revisión (nunca ejecutan solos).

## Partes

1. **Gestor universal de herramientas**
   Catálogo tipado de todas las herramientas existentes (chat, búsqueda SearXNG/Tavily, investigación, documentos, OCR, notas/tareas, memoria, imagen, video, audio, datos, sandbox JavaScript, GitHub, SSH/SFTP). Cada una declara entrada validada, permiso, si gasta, si usa red y límite de llamadas. Ninguna herramienta se usa si no está en la lista del agente y del proyecto.

2. **Llamadas nativas a herramientas**
   Cuando el modelo verificado declara "tool calling" (Azure/OpenAI y compatibles), se usa el formato nativo; si no, se mantiene la decisión JSON validada actual. Misma validación y aprobación en ambos casos.

3. **Ciclo ReAct completo con memoria de trabajo**
   Pensar → actuar → observar, con resumen acumulado de observaciones por ejecución (acotado en tamaño), límites de turnos, llamadas y presupuesto (budgetGate antes de credenciales). Observaciones de fuentes externas se tratan como datos, nunca como instrucciones.

4. **Orquestador multiagente**
   Coordinador que divide el objetivo en subtareas, especialistas que las ejecutan (en paralelo cuando no dependen entre sí, con tope de concurrencia) y revisor final que acepta o devuelve con observaciones. Presupuesto repartido por ejecución.

5. **Recuperación segura**
   Cada decisión recibida se guarda antes de crear el siguiente paso; al reabrir la app se reanuda desde el último estado guardado. Llamadas inciertas quedan "en revisión" y requieren confirmación para reintentar.

6. **AI Builder**
   Flujo guiado: requisitos → plan → código → ejecución en el sandbox QuickJS → pruebas → corrección (con límite de intentos) → entregable guardado en el espacio de trabajo. Sin acceso del código a almacenamiento, red ni claves.

7. **Pantalla de ejecución en vivo**
   Línea de tiempo por ejecución con agente, herramienta, entrada/salida resumida, costo, estado y botones aprobar/rechazar/pausar/detener; bandeja central de aprobaciones pendientes; versión móvil con menú lateral existente.

8. **Disparadores programados**
   Integración con las alarmas Android existentes: solo abren la ejecución para revisión.

## Cierre y verificación
- Pruebas por regla: herramienta fuera de lista rechazada; límite de llamadas y presupuesto respetados; aprobación ligada a la acción exacta; reanudación sin doble envío; aislamiento entre proyectos; revisor puede devolver trabajo; AI Builder no accede a red/almacenamiento.
- Suite completa y verificación de tipos en verde.
- Recorrido en vista previa con proveedor simulado: equipo de agentes, aprobación, recarga a mitad y reanudación, AI Builder.
- Informe honesto: qué quedó probado en vista previa y qué depende de Android, claves reales o servidor SearXNG real.

## Detalles técnicos
- Nuevos módulos en `src/lib/automation/`: `tools.ts` (registro), `orchestrator.ts`, `working-memory.ts`, `builder.ts`; ampliación de `react.ts` y `runner.ts`.
- Esquema aditivo vía Repo: tablas de ejecuciones, subtareas y observaciones con `project_id`; sin migraciones destructivas.
- Llamadas nativas en el adaptador compartido de proveedores, capacidad `tools` exacta vía registro/router.
- Actualizar `AGENTS.md` (regla de agentes adaptativos) y `roadmap.md`.
