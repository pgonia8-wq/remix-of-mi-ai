# MI AI build.11 — funciones que faltaban

## Construido
- **Sonoridad profesional (Editor de audio):** LUFS integrado, de corto plazo y momentáneo, rango de sonoridad (LRA), true-peak con sobremuestreo 4x según ITU-R BS.1770-4 / EBU R128. Normaliza a objetivos (Spotify/YouTube −14, Apple −16, Amazon −14/−2 dBTP, club −9, EBU R128 −23 o personalizado) con un limitador true-peak que vuelve a medir hasta respetar el techo. Guarda una versión cifrada con la medición antes y después.
- **Línea de tiempo de video arrastrable:** reordenar clips arrastrándolos, recortar arrastrando sus bordes, zoom, regla para mover la posición y zonas de transición visibles.
- **Vista previa compuesta:** lienzo en tiempo real con transiciones (disolver, barrido, deslizar, iris), PiP con keyframes, subtítulos y rotación. Usa los mismos tiempos que el render FFmpeg. Sin audio; el render final sigue siendo Media3 (Android) o FFmpeg (PC).
- **CAD paramétrico:** parámetros con nombre y fórmulas (`=ancho*2+3`, min/max/sqrt/sin/cos…), dependencias entre parámetros, detección de restricciones circulares y nuevo cálculo de todo al cambiar un valor. Las fórmulas se interpretan sin eval.
- **STEP (ISO 10303-21 AP214):** sólido B-rep cerrado (MANIFOLD_SOLID_BREP) con caras planas y aristas compartidas, en milímetros. Verificado: OpenCASCADE (gmsh 4.15) lo importa como 1 volumen 3D.
- **Malla, huesos y animación (Modelos 3D → Malla y animación):** abrir una pieza CAD o una malla guardada, seleccionar vértices tocando, editarlos con selección suave, crear jerarquías de huesos, asignar vértices automática o manualmente, poner keyframes de rotación y traslación, reproducir, guardar la malla cifrada y exportar un GLB animado (Khronos glTF-Validator: 0 errores) o un OBJ de la pose.
- **Voz en tiempo real con Azure OpenAI (GA /openai/v1)**, además de OpenAI. Opción para usar **herramientas durante la llamada** (memoria, notas, tareas, recordatorios, búsqueda web, JavaScript aislado y guardar en memoria). Cada llamada pasa por `invokeTool()` con límites, presupuesto y aprobación en pantalla cuando hace falta.

## Comprobado
- 346 pruebas automáticas (incluye las de sonoridad, fórmulas, STEP, rigging, GLB, línea de tiempo y voz con Azure y herramientas).
- En la vista previa: normalización de −47.8 a −14.0 LUFS; arrastrar para reordenar y recortar; vista previa reproducida; caja definida con parámetros (30 → 40 mm recalcula 13 500 → 32 000 mm³); STEP y GLB animado guardados; panel de voz con herramientas.

## Límites honestos
- Azure no ofrece hoy un contrato para generar **música** ni **modelos 3D**; no se inventó. Esas funciones siguen con los proveedores que sí las tienen.
- STEP: las superficies curvas se exportan como caras planas (no NURBS ni cilindros analíticos).
- Rigging rígido (un hueso por vértice), sin pesos suaves ni cinemática inversa.
- La vista previa de video no tiene audio y su sincronía es aproximada.
- La voz con Azure y sus herramientas no se probaron con tus claves reales. Faltan las pruebas en el teléfono.
