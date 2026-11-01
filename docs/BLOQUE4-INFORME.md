# Bloque 4 — Informe técnico (2026-11-01)

Leyenda: **Probado** = ejecutado de verdad en este entorno. **Simulado** = respuestas de modelo guionadas (sin claves ni coste). **Pendiente** = requiere teléfono, PC real, claves o servicios.

## 1. Arquitectura
Android (control, memoria, datos privados, sandbox QuickJS) → Gestor universal de herramientas (`invokeTool`) → Orquestador multiagente (plan DAG, especialistas en paralelo, auditor, replanificación) → Entornos elegidos por el Orquestador de recursos: teléfono, sandbox, PC Node (red local cifrada), VM vía SSH/PC Node. Todo por proyecto, migraciones aditivas, sin servidor obligatorio.

## 2–3. Archivos
Creados: `src/lib/automation/{schema-b4,tools,approvals,working-memory,orchestrator,quality,repo-intel,builder,triggers}.ts`, `src/lib/nodes/{protocol,client,storage,tunnels,resources}.ts`, `src/lib/core/adapters/tool-calls.ts`, `src/routes/autonomy.tsx`, `pc-node/{miai-node.mjs,protocol.mjs,README.md}`, `src/test/block4.test.ts`, AGENTS.md anidados.
Modificados: `src/lib/db/repo.ts` (esquema B4, sellado de secretos), `src/lib/core/index.ts` (recuperación al abrir, transporte nativo), adaptadores OpenAI/Azure (`chat.tools`), `capabilities.ts`, `automation/control.ts`, `routes/tools.tsx`, `AGENTS.md`, `roadmap.md`.

## 4. Herramientas
Registro tipado con familias A–H (~55 entradas). Operativas con implementación real: chat/razonamiento/visión/evaluación, búsqueda e investigación profunda, archivos (listar, leer, escribir con hash, eliminar con versión, buscar, versiones), terminal sin shell, Git local, 19 toolchains (Node, Python, Java, Kotlin, Gradle, GCC, Clang, CMake, Ninja, Rust, Cargo, Go, .NET, SQLite, PostgreSQL, Foundry…), publicación Git con aprobación, verificación de calidad, QuickJS, recursos del nodo, túneles, SQL solo lectura, imagen/voz/video, notas, tareas, memoria, recordatorios. Declaradas como no disponibles (con motivo): navegador automatizado, SSH/SFTP delegados a agentes, Docker directo, VM directa, OCR delegado.

## 5. Agentes
13 roles: coordinador, arquitecto, analista, frontend, backend, bases de datos, infraestructura, seguridad, pruebas, integración, depuración, auditor independiente, documentador.

## 6. AI Builder
Plan fijo requisitos → arquitectura → código → pruebas → seguridad → documentación, ciclo de corrección limitado, auditor que exige evidencia real, entrega con hash por archivo, versión, manifiesto e informe guardados en la Biblioteca. Necesita una carpeta autorizada en un PC Node.

## 7. Toolchains
Detectados en tiempo real en cada PC. En este entorno: node, npm, npx, python3, pip, gcc, rustc, cargo, git, sqlite3, psql.

## 8–11. Estado
- **PC Node**: servicio funcional; emparejamiento, cifrado, antirrepetición, recursos, procesos, cancelación, desconexión, recuperación (trabajos → «lost»), túneles: **probado** con proceso real en loopback y desde la vista previa. Descubrimiento UDP: implementado en el nodo; el teléfono usa QR/código (WebView sin UDP).
- **Almacenamiento privado**: carpetas explícitas, aislamiento, hashes, conflictos, versiones, cuotas, estado sin conexión: **probado**.
- **Tunnel Manager**: túnel de desarrollo LAN con destinos permitidos, TTL, registro, revocación, reconexión con política: **probado**. SSH local/inverso, SOCKS5, VPN: **pendiente** (requiere plugin nativo).
- **Resource Orchestrator**: selección determinista y conmutación: **probado** (lógica).

## 12. Migraciones
15 tablas nuevas aditivas (`auto_*`, `file_locks`, `tool_policies`, `pc_nodes`, `node_folders`, `sync_entries`, `tunnels`, `exec_envs`); proyecto-scoped incluidas en borrado de proyecto.

## 13–14. Pruebas
Suite completa: 31 archivos, 306 pruebas aprobadas, 1 omitida (commit Git real: el git de este entorno está bloqueado). `block4.test.ts`: grupos A–H. Recorrido en vista previa: emparejar PC real, autorizar carpeta, abrir túnel, crear ejecución y verla detenerse honestamente sin modelo configurado; persistencia tras recarga.
Pendiente: ejecución con proveedor real, Android físico (Keystore, CapacitorHttp a la LAN, alarmas), PC Windows/macOS, Docker, GPU, commit/push Git reales.

## 15–19. Dependencias, límites y riesgos
- Android: CapacitorHttp para HTTP en LAN, alarmas existentes, Keystore. Sin UDP en WebView.
- Hardware: una PC con Node 20+; Docker opcional para aislamiento fuerte.
- Proveedores: modelos verificados con `chat` (y `chat.tools` para llamadas nativas). Sin modelo, las ejecuciones se detienen sin cobrar.
- Límites: sin Docker, la memoria de procesos no está limitada por el sistema (CPU y tamaño de archivo sí). GPU no detectada. Investigación profunda y herramientas de proveedor dependen de claves.
- Riesgos: tráfico LAN en HTTP con cuerpo cifrado de extremo a extremo (metadatos visibles); un nodo comprometido puede mentir sobre resultados (el auditor sólo ve lo que el nodo informa).
