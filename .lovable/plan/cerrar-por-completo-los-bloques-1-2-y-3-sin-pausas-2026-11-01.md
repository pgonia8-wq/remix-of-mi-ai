# Cerrar por completo los bloques 1, 2 y 3 (sin pausas)

Directiva de Fer: terminar todo lo pendiente de los bloques 1–3 sin hacer más preguntas, y avisar solo al final. No se compila la APK todavía (eso es el bloque 5).

## Qué falta y qué se hará

**Bloque 1 — seguridad y gasto**
1. R18 memoria: verificar y restaurar respaldos v3 leyendo por partes (sin cargar el archivo entero), tablas paginadas y descifrado público con límite de memoria fijo.
2. Contabilidad de gasto: revisar todas las llamadas directas (fuera del chat y del ejecutor: investigación, voz, imágenes en lote, verificaciones, trabajos remotos) y pasarlas por el control de presupuesto antes de usar claves; costo de trabajos remotos registrado al completarse.
3. Confirmación de presupuesto con un diálogo propio de la app (en lugar del aviso del navegador), válido para una sola llamada.
4. Repasar R01–R20 uno por uno con una prueba de regresión por riesgo; marcar cada uno cerrado o "solo verificable en Android".
5. Importar respaldos grandes desde archivo sin leerlo completo como texto.

**Bloque 2 — medios y documentos**
6. Video multipista: además del audio de fondo, textos como clips independientes con inicio y duración en la línea de tiempo.
7. Máscaras/relleno: comprobar que solo se envían a modelos que declaran soporte de máscara; prueba de rechazo.
8. Comprobar que PowerPoint y OCR cargan bien en la vista previa (paquetes instalados con aviso).

**Bloque 3 — investigación y datos**
9. Investigación: bloquear direcciones privadas/locales también tras redirecciones y mostrar claramente fuente leída frente a resumen del buscador.
10. Revisión final de herramientas de datos y finanzas con casos de prueba de valores concretos.

## Cierre
- Toda la suite de pruebas y la revisión de tipos en verde.
- Recorrido en la vista previa de: presupuesto con confirmación, respaldo/restauración, OCR, editor de video, investigación y datos.
- Informe final honesto: lo cerrado, y lo que solo puede verificarse en Android, con claves reales o un servidor SearXNG real (no se presentará como verificado).

## Detalles técnicos
- Todo acceso a datos por `Repo` con `projectId`; sin almacenamiento nuevo fuera de SQLite; esquema solo aditivo.
- Lectura por partes con `File.stream()`/`linesOf` y verificación de etiquetas incremental; restauración por lotes dentro de la transacción existente.
- `budgetGate` antes de credenciales en cada adaptador invocado directamente; `recordUsage` sin silenciar errores de forma ciega (registrar fallo visible).
- Clips de texto: extensión del modelo de línea de tiempo en `video-edit.ts` y del plugin Media3 vía `scripts/native/` (sin editar `android/`).
- Actualizar `roadmap.md` al terminar cada punto.
