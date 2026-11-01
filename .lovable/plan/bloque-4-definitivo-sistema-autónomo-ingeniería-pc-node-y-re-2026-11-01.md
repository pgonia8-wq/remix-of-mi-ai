# Bloque 4 definitivo — Sistema autónomo, ingeniería, PC Node y recursos distribuidos

Se construye todo lo de la guía de Fer, secciones 1 a 23, en una sola tanda, sin pausas ni preguntas. No cambia el diseño, la navegación ni la distribución: las pantallas nuevas usan el menú y los estilos actuales. La APK sigue en el bloque 5.

## Punto honesto clave
Un teléfono Android no puede ejecutar compiladores reales (Gradle, GCC, Rust, Python, etc.) dentro de la app. Por eso la ingeniería "real" se ejecuta en el **PC Node**, un programa nuevo e independiente que se instala en la PC (Windows/Linux/macOS). En el teléfono quedan la coordinación, la memoria, los datos privados y el sandbox JavaScript ligero (QuickJS). Cada herramienta muestra si está disponible de verdad; nunca se marca como operativa algo que solo tiene interfaz.

## Orden de construcción

1. **Inspección inicial** del repositorio, AGENTS.md, roadmap, adaptadores, sandbox, alarmas y agentes: qué existe y qué se amplía sin duplicar.

2. **Gestor universal de herramientas** (sección 2): catálogo tipado con todas las familias A–H. Cada herramienta declara entrada validada, permisos, red, coste (o "desconocido"), límite de llamadas, tiempo máximo, paralelismo, entorno requerido (Android, sandbox, PC Node, VM), riesgo, reglas de aprobación y compatibilidad por agente y proyecto. Estado de disponibilidad real calculado en el momento.

3. **Llamadas nativas a herramientas** (3): formato nativo para modelos con capacidad verificada y registrada; respaldo con la decisión JSON actual. Ambos pasan por el mismo gestor, autorización, budgetGate y auditoría. Sin deducir capacidades por el nombre del modelo.

4. **Motor ReAct avanzado y memoria de trabajo** (4): ciclo planificar→…→entregar; cada ejecución guarda objetivo, plan, decisiones, observaciones, archivos, costes, tokens, límites, evidencias, errores y checkpoints. Memoria persistente y resumida. Datos externos marcados como no confiables. Presupuesto total, por agente, por herramienta, tokens, llamadas, tiempo y concurrencia.

5. **Orquestador multiagente** (5): los 13 roles, grafo de dependencias, paralelismo con tope configurable, bloqueo de archivos para que dos agentes no editen el mismo, replanificación, reasignación y auditor independiente que verifica resultados reales (aprobar, rechazar, pedir correcciones, exigir evidencias). Solo se termina con criterios de aceptación cumplidos.

6. **Recuperación y continuidad** (10): cada decisión se guarda antes de avanzar; al reabrir se listan activas, se reanudan las seguras, las inciertas quedan en revisión; claves de idempotencia; cancelar y deshacer cuando sea posible.

7. **Aprobaciones y seguridad** (12): bandeja central; cada aprobación ligada a acción, parámetros, destino, coste y contexto con huella; si algo cambia, deja de valer. Revocación inmediata y cierre de conexiones. Sin claves en registros, instrucciones, memoria o repositorios.

8. **PC Node** (13): programa independiente (Node.js, empaquetable para Windows/Linux/macOS) dentro del proyecto. Descubrimiento en red local, emparejamiento por QR o código temporal, identidad criptográfica por dispositivo, autenticación mutua y canal cifrado de extremo a extremo propio (no se confía en la red Wi-Fi). Funciones: hardware, almacenamiento, tareas, procesos autorizados, transferencia, logs, estado, cancelar, recuperar, latido para detectar desconexión. Funciona sin Internet.

9. **Motor de ingeniería** (6) sobre PC Node: espacio por proyecto, archivos, terminal, procesos, dependencias, compilación, pruebas, logs, Git. Detección real de toolchains instalados (Node, Python, Java/Kotlin, Android SDK/Gradle, GCC/Clang, CMake/Ninja, Rust, Go, .NET, Git, SQLite/PostgreSQL, Foundry/Hardhat). Aislamiento: contenedor (Docker/Podman) cuando existe; si no, proceso limitado con tiempo, memoria y carpeta restringida, y se informa el nivel de aislamiento real. Sin acceso a credenciales de MI AI ni a otros proyectos.

10. **Repositorios inteligentes** (8): estructura, tecnologías, dependencias, referencias, ramas, commits, diffs, versiones, conflictos, regresión. Push/publicación/despliegue solo con aprobación expresa; nunca sobrescribir trabajo humano.

11. **Calidad y verificación** (9): compilación, tipos, lint, unitarias, integración, E2E, APIs, seguridad, dependencias vulnerables, rendimiento, integridad. Evidencias guardadas con estado: aprobada, fallida, no ejecutada, bloqueada o simulada.

12. **AI Builder** (7): requisitos→…→entrega con ciclo de corrección limitado; entregables con código, configuración, documentación, resultados de pruebas, logs, artefactos, hashes, versiones e informe de auditoría. QuickJS para tareas ligeras; PC Node para lo real.

13. **Almacenamiento privado en PC** (14): carpetas elegidas explícitamente, espacio por proyecto, lectura/escritura, sincronización, versiones, cuotas, conflictos, hashes; distingue local, PC, VM, sincronizado y pendiente; si la PC se desconecta conserva metadatos y nunca sobrescribe con versiones viejas.

14. **Gestor de túneles** (15): SSH local/reverso y SOCKS5 a través del plugin SSH existente y del PC Node; destinos y puertos en lista permitida, duración límite, registro de origen/destino/agente/duración, revocación, reconexión con política. Nunca puertos públicos ni proxy abierto. VPN queda declarada como no disponible salvo que el entorno la provea.

15. **Orquestador de recursos** (16): elige entre Android, sandbox, PC Node, VM (vía SSH) o externa autorizada según CPU, RAM, GPU, toolchains, latencia, coste y restricciones; automático con política aprobada o manual; aviso antes de enviar datos privados; alternativa si un nodo desaparece sin duplicar.

16. **Disparadores** (17): recordatorios, ejecuciones preparadas, pausadas y desconexión de nodos con las alarmas existentes; solo abren revisión.

17. **Pantalla de ejecución** (11): objetivo, estado, agentes, plan, subtareas, herramientas, archivos, costes, tokens, tiempo, pruebas, errores; aprobar, rechazar, pausar, reanudar, detener, revisar, entregables; más pantallas de nodos, carpetas y túneles con el estilo actual.

18. **Pruebas obligatorias** (20, grupos A–H) y **recorridos** (21): primer escenario completo en vista previa con proveedor simulado; segundo escenario ejecutando un PC Node real dentro de este entorno (emparejar, recursos, carpeta, compilar, túnel, desconectar, reconectar). Se separará lo comprobado de verdad, lo simulado y lo que requiere tu teléfono y tu PC.

19. **Cierre**: AGENTS.md, roadmap.md, documentación técnica y el informe final con los 19 puntos de la guía.

## Detalles técnicos
- Nuevos módulos en `src/lib/automation/`: `tools.ts`, `working-memory.ts`, `orchestrator.ts`, `builder.ts`, `approvals.ts`, `quality.ts`, `repo-intel.ts`; ampliación de `react.ts`, `runner.ts`, `store.ts`.
- Nuevos en `src/lib/nodes/`: emparejamiento (ECDH P-256 + firma por dispositivo, código temporal/QR, AES-GCM con contador anti-repetición), cliente, almacenamiento privado, túneles, orquestador de recursos.
- `pc-node/`: servicio independiente con API WebSocket local, descubrimiento UDP/mDNS, detección de toolchains, ejecución de procesos limitada, Git, archivos con hashes; pruebas propias.
- Tool calling nativo en el adaptador compartido, capacidad `tools` registrada por modelo.
- Esquema aditivo vía Repo con `project_id` en ejecuciones, subtareas, dependencias, observaciones, memoria, aprobaciones, checkpoints, resultados, nodos, recursos, carpetas, sincronizaciones, túneles, entornos, artefactos y evidencias.
- Riesgo conocido: WebView Android no permite UDP; el descubrimiento desde el teléfono requerirá un pequeño método nativo en el script de Android (o QR/código como vía principal), probable solo en bloque 5.
