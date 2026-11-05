# Pruebas ejecutadas y resultados

1. Suite completa `bunx vitest run --reporter=json --outputFile=/tmp/miai-audit/vitest.json`: **463 aprobadas, 1 omitida, 0 fallidas**. El comando compuesto expiró durante lint, después de que Vitest escribiera informe completo exitoso. Revisor independiente ejecutó también toda suite con 2 workers: mismo resultado, 110,94 segundos. No sumar repeticiones como casos distintos.
2. Omitida: Git real en PC Node init/commit/diff/version anterior con aprobación. No se ejecutó Git de escritura.
3. Revisor modelos ejecutó 7 suites (130 aprobadas, 1 omitida): subconjunto, no 130 adicionales.
4. Lint completo: agotó 240 segundos; informe vacío, **inconcluso**. Segundo pase src con prettier/prettier off SOLO en comando: 307 archivos, **62 errores, 14 advertencias**, salida 1. No config ni pruebas debilitadas; pase acotado no sustituye lint completo.
5. Reproducción SQL real en sql.js desechable: contexto 80→20 al restaurar, interrupted→sin estado; duplicación mismo fallo; inyección controlada de error INSERT messages deja proyecto parcial, 2→3 proyectos. Vault identidad sobre datos sintéticos: **no prueba criptografía**.
6. Playwright Chromium: crear proyecto→recargar→abrir conversaciones; persistencia verdadera en preview. Vista 1280×1800 y 390×844; capturas inspeccionadas. Sin pageerror observado, sin overflow móvil en esa página. No conversación con proveedor configurado.
7. Scanner básico: no backend conectado, varios checks no aplican. Deep: estado incomplete, un hallazgo. Dependencias: 16 avisos.
8. Build/typecheck manual no ejecutados (harness del entorno); no APK reconstruida, no claim de compilación. Logs observabilidad ausentes al inicio, no evidencia positiva de build.

Evidencias sanitizadas en evidencia/. Las capturas reflejan solo datos sintéticos. No se efectuaron ataques destructivos, migraciones, deploys, pagos ni cambios de dependencias.
