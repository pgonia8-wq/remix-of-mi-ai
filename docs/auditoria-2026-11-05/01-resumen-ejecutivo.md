# Resumen ejecutivo

**Dictamen provisional: no certificada para lanzamiento. Auditoría parcial con defectos confirmados; ninguna corrección aplicada.**

Versión base 0.1.0; revisión fa91b7285de26da76f5a5fe131e9f78b95851503; checkout inicialmente limpio. Fecha 5 noviembre 2026, UTC. Entorno /dev-server, Node 22.23.4, Bun 1.4.4, preview localhost:8080. Android previsto por script: mínimo 30, compile/target 35. No se inspeccionó un APK instalado ni se reconstruyó Android.

463 pruebas aprobadas, 1 omitida, 54 archivos de prueba. Los grupos internos del informe JSON (157) no son 157 archivos. Reproducciones independientes confirman pérdida de contexto y estado interrumpido al restaurar, pérdida al duplicar y copia parcial tras fallo de escritura. La web creó un proyecto sintético, lo conservó tras recarga y abrió sus conversaciones; sin errores de página observados y sin desbordamiento horizontal a 390×844. Eso no prueba chat con proveedor ni Android.

La revisión estática acotada de src encontró 62 errores y 14 advertencias; no equivalen a 76 defectos funcionales. El lint completo excedió el límite temporal. No se ejecutó build ni typecheck manual: el entorno los gestiona; no había señal actual de compilación en observabilidad.

La revisión de dependencias reportó 16 avisos (repeticiones transitivas incluidas), 10 altos y 6 moderados. El análisis profundo actual retornó estado **incomplete** con un hallazgo sobre bloqueo de hojas de cálculo mediante comodines. No se declara segura la aplicación ni completo ese análisis.
