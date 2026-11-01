# Rediseño visual Full Premium de MI AI (solo capa visual)

Misma app, misma estructura, mismas funciones, misma navegación. Solo cambia la apariencia.

## Estado inicial (inspeccionado)
- Tema central ya existe en `src/styles.css` (grafito + acento verde). Casi ninguna pantalla usa colores fijos; solo 4 sitios (fondos oscuros de diálogos/cajón y raíz).
- Tipografías actuales: Space Grotesk + DM Sans cargadas desde internet (no funcionan sin conexión en Android).
- 29 pantallas y 23 componentes propios, más la librería de componentes base.

## Fase 1 — Capturas "antes"
Capturar con Playwright, en móvil (360x800, tamaño Poco C40) y escritorio, todas las pantallas: inicio, chats, chat, proyectos, biblioteca, herramientas, workspace, voz, música, video, 3D, modelos, configuración, agentes, autonomía/AI Builder, código, memoria, trabajos, automatización, documentos, datos, investigación, estudio, notas, servidores, GitHub, diagnósticos, editores de audio/video; además menú lateral abierto, un diálogo y estados vacíos.

## Fase 2 — Sistema visual centralizado (`src/styles.css`)
- Paleta: fondos grafito profundo / antracita / carbón en 3 niveles de superficie; violeta eléctrico moderado como acento principal (`primary`, foco, selección); azul frío discreto como acento informativo (`info`); verde actual conservado como `success` (confirmaciones, actividad); rojo sobrio para errores; textos blanco suave / gris claro / gris neutro.
- Nuevos tokens: `success`, `info`, `warning`, `surface-1/2/3`, `border-subtle`, sombras `shadow-soft`/`shadow-raised` (una sola capa), `ring` violeta, duraciones de transición (120/180 ms), opacidad de deshabilitado.
- Tipografía: Space Grotesk (títulos) + DM Sans (texto) **empaquetadas localmente** (sin descarga en línea, para modo sin conexión). Escala definida: título, subtítulo, cuerpo, secundario, etiqueta, metadatos; números tabulares para costos y métricas.
- Radios unificados; sin blur, sin brillos permanentes, sin degradados grandes; un único degradado sutil reservado al logotipo/marca.
- Respeto de `prefers-reduced-motion`.

## Fase 3 — Aplicación global
- Componentes base (botón, campo, select, tarjeta, pestañas, diálogo, cajón, menú, tooltip, badge, switch, progreso, toast, skeleton): acabados, estados normal/hover/pressed/foco/deshabilitado/carga, variantes `success` e `info` añadidas sin cambiar variantes existentes.
- Menú lateral y cajón móvil: fondo grafito, indicador de selección fino violeta, iconos lucide del mismo grosor/tamaño, sin mover ni reordenar nada.
- Chat: burbujas, compositor, adjuntos, Markdown y bloques de código con el nuevo sistema.
- Revisión pantalla por pantalla de las 29 rutas y 23 componentes: reemplazar colores sueltos por tokens, unificar estados vacío/carga/error, badges de estado (éxito verde, info azul, activo violeta). Sin cambiar clases de tamaño, posición, espaciado estructural ni el orden de elementos.
- Gráficos (`ProTools`) a la paleta nueva.

## Fase 4 — Optimización Android
Revisar contraste (AA), áreas seguras, teclado en chat, sin overflow a 360 px, transiciones solo de color/opacidad.

## Fase 5 — Validación
- Capturas "después" de las mismas pantallas y tamaños; cuadrícula comparativa antes/después para confirmar mismas posiciones y elementos.
- Recorridos funcionales con Playwright: navegar todo el menú, crear proyecto, abrir chat y escribir, abrir diálogo, guardar en configuración.
- Suite completa de tests y compilación sin errores; consola sin errores nuevos.
- Revisión del diff: solo archivos de estilo/clases visuales; revertir cualquier cambio funcional.

## Entregables
- Informe final (secciones A–E del documento) en `docs/REDISENO-INFORME.md`, separando verificado / con problemas / no ejecutado / pendiente por entorno (Android físico queda pendiente hasta la APK del bloque 5).
- Guardar la identidad elegida en la memoria del proyecto.

## Fuera de alcance
Ningún cambio de rutas, lógica, datos, proveedores, navegación ni distribución. No se compila APK.
