# Bloques 1, 2 y 3 seguidos, sin pausas

Trabajo continuo, sin pedir "continúa" entre tramos. Solo aviso al terminar los tres, o antes si algo necesita una decisión tuya (por ejemplo, una clave o un permiso).

Nota honesta: "100%" significa construido y probado en la vista previa con pruebas automáticas. Lo que dependa de tus claves reales, de un servidor de búsqueda real o de un teléfono Android queda marcado como "pendiente de verificación real", sin fingir que funciona.

## Bloque 1 — seguridad y núcleo (resto)
1. Presupuesto conectado a cada llamada real (chat, imagen, audio, video): costo exacto, estimado o "sin precio"; aviso al 80%, bloqueo al 100% con confirmación de esa llamada; gasto del mes por proyecto.
2. Respaldos por partes: cifrado por trozos con verificación de cada trozo; los respaldos anteriores siguen abriéndose.
3. Restauración y rotación de llaves reanudables: registro de avance; al reabrir, reanuda o revierte, nunca una mezcla.
4. Riesgos R01–R20 reproducibles corregidos; los que solo se ven en Android quedan anotados.

## Bloque 2 — medios y documentos
1. OCR local de imágenes y PDF escaneados (texto buscable y copiable).
2. Imagen: máscaras y relleno (inpainting) con modelos que lo declaren, y procesamiento por lotes.
3. Video: línea de tiempo multipista (cortes, orden, audio de fondo, textos) exportada con el motor local.
4. Audio/música: mezcla de pistas, fundidos y normalización locales; música generada solo con proveedores que lo declaren.
5. Documentos: exportar a PowerPoint y comparar dos documentos con diferencias marcadas.
6. 3D: visor mejorado y conversión/medición básica local de modelos GLB.

## Bloque 3 — investigación y datos
1. Investigación profunda con SearXNG: varias rondas de búsqueda, lectura de fuentes, resumen con citas numeradas y enlaces verificados.
2. Análisis de datos: gráficos, tablas dinámicas, limpieza de columnas y estadísticas descriptivas locales, exportables.
3. Herramientas profesionales: calculadoras financieras (préstamos, VAN/TIR), conversión de unidades y plantillas de informes del proyecto.

## Verificación
- Pruebas automáticas por cada regla nueva y prueba completa en la vista previa móvil al cerrar cada bloque.
- Aviso final con lo completado y la lista exacta de lo pendiente de verificación real.

## Detalles técnicos
- Todo pasa por `Repo` con `projectId`; tablas nuevas aditivas.
- Registro de costos en el ejecutor compartido; tarifas por modelo en tabla local editable.
- Respaldo v3 con registros AES-GCM por trozo (índice + bandera final); v2 legible. Tabla `restore_journal`.
- OCR con tesseract.js WASM cargado bajo demanda; PPTX con pptxgenjs cargado bajo demanda; diff de documentos local.
- Línea de tiempo de video como proyecto declarativo exportado con Media3 (nativo); en la vista previa solo validación.
- No se compila la APK hasta el Bloque 5.
