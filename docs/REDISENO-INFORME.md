# Informe — Rediseño visual Full Premium (2026-11-01)

## A. Identidad visual
- Paleta: fondos grafito (oklch 0.165/0.14 tono 285), superficies 1/2/3; violeta eléctrico moderado `primary` (oklch 0.66 0.17 290); azul frío `info`; verde MI AI conservado como `success`; `warning`; rojo sobrio `destructive`; textos blanco suave / gris claro / gris neutro.
- Tipografía: Space Grotesk (títulos, -0.01em) + DM Sans (texto), ahora empaquetadas localmente (@fontsource) para modo sin conexión; números tabulares en tablas/métricas.
- Tokens: superficies, `border-subtle`, `shadow-soft`/`shadow-raised` (una capa), `ring` violeta, `--gradient-brand` (solo logotipo), duraciones 120/180 ms, opacidad de deshabilitado.
- Estados: foco visible violeta global, transiciones solo de color/opacidad, selección de texto violeta, barras de desplazamiento discretas, `prefers-reduced-motion` respetado.
- Menú: indicador fino violeta en la opción activa, marca con degradado sutil, icono de privacidad en verde.

## B. Archivos
- `src/styles.css` (tokens y base), `src/routes/__root.tsx` (fuentes locales en lugar de Google Fonts, color de tema), `src/components/AppShell.tsx` (estados activos/marca, sin mover nada), `ui/dialog.tsx`, `ui/alert-dialog.tsx`, `ui/drawer.tsx` (fondo del velo con token), `src/routes/index.tsx` (marca de éxito en verde). Dependencias: `@fontsource/dm-sans`, `@fontsource/space-grotesk`.

## C. Cobertura
Todas las pantallas consumen los tokens centrales (verificado: no quedan colores fijos en pantallas). Capturas antes/después de 27 rutas en móvil 360x800 y escritorio 1280.

## D. Integridad
Diff revisado: solo clases y estilos visuales. Sin cambios de rutas, lógica, datos, navegación ni distribución; las comparaciones muestran mismas posiciones y elementos.

## E. Pruebas
- Verificado y aprobado: compilación OK; 309 tests pasan (1 omitido, Git del entorno); 27 rutas × 2 tamaños sin errores de consola; comparación visual.
- No ejecutado: recorridos con proveedores reales.
- Pendiente por entorno: Android físico (Poco C40), rendimiento real del WebView — en el bloque 5.
