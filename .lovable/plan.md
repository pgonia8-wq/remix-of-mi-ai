# Por qué se tarda la prueba de inicio en Android 11, y cómo cerrarla

## Qué está pasando
- Este entorno no tiene aceleración de hardware para virtualización (KVM), así que el emulador de Android 11 corre por software y puede tardar mucho en arrancar, o no terminar nunca.
- La APK build.3 ya está compilada y entregada. Lo único que falta comprobar es que se instale y se abra en Android.

## Plan
1. Poner un límite fijo de 10 minutos al arranque del emulador local. Si no arranca a tiempo, se informa como "no ejecutado en este entorno" y no como fallo de la app.
2. Pasar la prueba completa (instalar la APK, abrirla y correr la autoprueba de cifrado y recuperación) a GitHub Actions, que sí tiene aceleración de hardware, con Android 11 (API 30).
3. Actualizar el informe de pruebas con tres columnas separadas: compilado, probado en emulador (indicando el entorno) y pendiente en el Poco C40.
4. No se cambia ninguna función de la Fase 1, ni la arquitectura ni la seguridad.

## Detalles técnicos
- scripts/emulator-test.sh: agregar un tiempo límite y que el resultado indique si fue omitido o si falló.
- .github/workflows: un paso con reactivecircuits/android-emulator-runner (api-level 30, x86_64, KVM activado) que instala la APK, abre el enlace de autoprueba y recoge el resultado del registro del sistema (logcat).
- ARMv7 y ARM64 siguen comprobándose a nivel de archivos dentro de la APK. Para comprobar que funcionan de verdad hace falta el Poco C40.
