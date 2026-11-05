# Auditoría de lanzamiento de MI AI (Google Play) y plan de cierre

Veredicto: **todavía no está lista para publicarse en Google Play.** Las funciones están construidas; lo que falta es sobre todo empaquetado de tienda, requisitos legales y de seguridad, y pruebas reales.

## 1. Bloqueadores (sin esto Play la rechaza o es riesgoso)
1. **Formato de tienda**: hoy solo se produce APK. Play exige paquete AAB firmado con clave de producción.
2. **Firma de producción**: el proceso publica como "estable" una APK firmada con la clave de pruebas (contraseña conocida). Debe exigir la clave definitiva.
3. **Botón "Reportar contenido"** en respuestas, imágenes, videos y audio generados: obligatorio en Play para apps de IA.
4. **Política de privacidad y términos** dentro de la app y en una dirección pública, más la ficha de "Seguridad de los datos" (micrófono, VPN, archivos, agentes en segundo plano).
5. **Versión de Android objetivo**: está en 35; desde el 31 de agosto de 2026 Play exige 36 para apps nuevas. Ya aplica hoy.

## 2. Mal configurado
- El número de versión vuelve a 1 al compilar fuera del proceso automático: rechazaría actualizaciones.
- El proceso de compilación acepta dependencias distintas a las fijadas si falla la instalación exacta.
- No hay optimización/ofuscación del código de Android confirmada.

## 3. A medio hacer
- **Cosmos video**: se ofrece como generador pero solo está comprobado por chat. Se ocultará como opción de video hasta tener la dirección real (sin más pruebas que cuesten cuota).
- Suscripciones/niveles y versión web (PWA): sin construir; no bloquean un lanzamiento gratuito.
- Pruebas con cuenta Azure real, teléfono físico y Demucs real: pendientes.

## 4. Faltante
- Reporte de fallos de la APK en producción (hoy solo existe en la vista previa).
- Pantalla de soporte/contacto y versión visible de la app.

## 5. Riesgos de seguridad
- Herramientas de internet del teléfono: una dirección que redirija a la red local podría alcanzarse antes de bloquearse. Se bloquearán redirecciones y se validará la IP real.
- Registros de errores sin borrar datos sensibles: se filtrarán claves y tokens.
- Permisos de servicio en segundo plano (VPN, agentes) requieren justificación en Play.

## Orden de trabajo
1. Seguridad: bloquear redirecciones/red local y filtrar secretos en registros (con pruebas).
2. Ocultar video de Cosmos hasta verificarlo.
3. Botón "Reportar contenido" con envío al desarrollador sin salir de la app.
4. Pantallas de Privacidad, Términos, Soporte y "Acerca de" con versión; texto borrador para que lo revises.
5. Android: objetivo 36, numeración de versión fija, optimización activada, dependencias exactas.
6. Compilación de tienda: AAB + APK firmados con clave de producción; la publicación "estable" falla sin ella.
7. Reporte de fallos local opcional (sin enviar datos sin tu permiso).
8. Compilar build.23 y checklist de Play Console (ficha de seguridad de datos, permisos, clasificación de contenido).

## Lo que necesito de ti después
- Crear la clave de producción (te guío) y guardarla como secretos de GitHub.
- Correo de soporte y nombre legal del titular para privacidad/términos.

## Detalles técnicos
- SSRF: `CapacitorHttp` sin seguir redirecciones, validar cada salto y resolver DNS para rechazar rangos privados (`src/lib/core/research.ts`, `src/lib/automation/phone-tools.ts`).
- Redacción en `src/lib/error-capture.ts` (patrones de claves, Bearer, api-key).
- Cosmos: quitar `video.generate` salvo endpoint `inference.ml.azure.com` verificado (`src/lib/providers.ts`, `adapters/cosmos.ts`).
- Reporte: tabla local `content_reports` vía Repo + `mailto`/compartir al correo de soporte con hash del contenido, sin claves.
- `scripts/android-prepare.sh`: target/compile 36, `minifyEnabled true` + reglas ProGuard para Capacitor/SQLCipher, versionCode obligatorio.
- `.github/workflows/android.yml`: `bundleRelease`, `--frozen-lockfile` estricto, fallar release sin keystore, prueba en emulador API 35/36.
