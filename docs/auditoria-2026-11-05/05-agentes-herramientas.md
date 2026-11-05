# Agentes y herramientas

Registro/ejecución: chatToolSet→allowlist→runChatTool→invokeTool→validación/aprobación/checkpoint→executor local/remoto→Repo/AssetStore→mensaje o tarjeta de ejecución. Refs: chat-tools.ts:72,103-130; automation/tools.ts:315; chat.$chatId.tsx:192-220.

Roles exclusivos implementados en automation/role-models.ts:6-34, persistidos en orchestrator.ts:214-220. Identidad por provider_id + remote_id normalizado: no demuestra modelos base diferentes si dos registros apuntan al mismo backend. Coordinador/auditor distintos y especialistas se prueban con inventario simulado, no razonamiento real.

## Pistas confirmadas o descartadas
- Constructor científico-tecnológico: ausente del enum de roles; no prueba que ese mensaje concreto ocurriera en el dispositivo.
- ionic-v1: sin coincidencia en src; no implementado como herramienta, pero puede existir como identificador remoto introducido por usuario.
- web.fetch sin URL: argumentos obligatorios rechazan {} antes de red; para búsqueda existe research.web.
- ws.snapshot sin label: rechaza {}; espacio vacío se rechaza explícitamente. No son falsos respaldos correctos.
- needs_human: estado persistido real; agrupa causas distintas y permite revisión/reanudar. No prueba recuperación adecuada de cada error real.
- “iniciada”: fila active + arranque driver, no evidencia de primera tarea. F08.

Autonomía: límites predeterminados 60 llamadas, 12 turnos/tarea, 30 llamadas/agente, concurrencia 2, 2 replanificaciones. Chat: hasta 30 turnos; sus herramientas usan run con límite 300. No equivalen a capacidad de completar cualquier encargo.

429: chat tiene reintento acotado en providers.ts; adaptador universal http.ts clasifica/propaga sin mismo bucle. No anunciar recuperación uniforme. Jobs guardan ID y piden revisión si envío ambiguo: no reenvío automático, pero tampoco confirmación de cargo inexistente.

Revisores independientes reales utilizados en esta auditoría: sub_kfvaxfgx (inventario/datos/distribución) y sub_3e6vw8dy (proveedores/agentes/herramientas), ambos completados; solo lectura. No son agentes de MI AI ni prueba de su autonomía.
