# MI AI — Cierre de auditoría y sistema autónomo

Orden acordado: primero las omisiones de la auditoría (secciones A–N y riesgos R01–R20), después el sistema autónomo. Se conserva todo lo existente, Azure multimarca como prioridad, SearXNG abierto y arquitectura local-first Android.

## Bloque 1 — Seguridad y núcleo (riesgos primero)
- Respaldos por bloques sin cargar archivos grandes en memoria; restauración interrumpida recuperable.
- Rotación de claves reanudable tras cierre inesperado.
- Costos: estimación por modelo cuando el proveedor la declare, "desconocido" cuando no; presupuestos por proyecto.
- Proyectos: archivar, duplicar, exportar/importar uno solo.
- Corrección de los riesgos R01–R20 con su prueba de regresión cada uno.

## Bloque 2 — Medios y documentos
- Imagen: OCR, máscaras/inpainting por capacidad, lote.
- Video: línea de tiempo multipista, transiciones, capas de texto (Media3).
- Audio/música: generación vía Azure, normalización/fades, separación de pistas cuando haya modelo capaz.
- Documentos: presentaciones PPTX, plantillas, comparación de documentos.
- 3D: visor mejorado y exportación; CAD queda declarado solo si no hay motor real.

## Bloque 3 — Investigación, datos y profesional
- SearXNG con búsqueda profunda, lectura de páginas y citas verificadas.
- Datos: regresión, correlaciones, tablas dinámicas, gráficos exportables.
- Herramientas profesionales de la auditoría (J01–J08) con fórmulas deterministas.

## Bloque 4 — Sistema autónomo
- Motor ReAct con tool calling nativo (Azure/OpenAI, Anthropic, Gemini) y reintento seguro.
- Tool Manager: registro de herramientas con permisos, límites de llamadas y costo, aprobación por paso sensible.
- Orquestador multiagente: planificador que divide la tarea, agentes especialistas en paralelo con presupuesto, revisor final.
- Memoria de trabajo por ejecución, reanudación tras recarga sin duplicar llamadas cobradas.
- AI Builder: generar, ejecutar en sandbox, corregir y guardar proyectos de código dentro del proyecto.
- Disparadores Android (alarmas) que llevan a revisión, nunca ejecutan solos.
- Pantalla de ejecución en vivo: pasos, herramientas, costo, aprobar/detener.

## Bloque 5 — Compilación
- Una APK final con la firma fija de build.7/8, pruebas completas y informe separando: programado, probado en web, compilado, pendiente en Poco C40.

## Detalles técnicos
- Todo acceso vía Repo con projectId; nuevas tablas aditivas en el esquema.
- Herramientas del agente reutilizan el router de capacidad exacta y el sandbox QuickJS; el modelo nunca concede permisos.
- Cada bloque termina con pruebas vitest y verificación en Chromium; sin APK hasta el bloque 5.
- Lo que requiera credenciales reales o teléfono se reporta como pendiente, no como hecho.
