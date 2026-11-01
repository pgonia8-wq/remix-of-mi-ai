# Suites avanzadas — build.9

## Implementado
- Audio local: Web Audio OfflineAudioContext, EQ paramétrico, tres bandas con compresión, ganancia, limitador enlazado estéreo de pico de muestra y medición RMS/pico; WAV cifrado.
- Stems: integración real del ejecutable Demucs htdemucs en PC emparejado; voz/batería/bajo/otros. Necesita Demucs/PyTorch y repositorio de pesos instalado previamente. Sin inferencia simulada ni descarga automática; no se ejecutó Demucs aquí.
- Video: FFmpeg en PC autorizado, corte/disolver/barrido/deslizar/iris, PiP hasta cuatro capas, posición interpolada entre inicio/fin, rotación, audio original con silencios cuando el clip carece de audio, fondo mezclado y subtítulos. Timeline cifrada guardada/reabierta. El exportador Media3 en teléfono sigue disponible para edición básica, no transiciones generales.
- CAD: JSCAD CSG poligonal paramétrico en mm, caja/esfera/cilindro/perfil extruido, unión/resta/intersección, transformación, visibilidad/historial, deshacer/rehacer, volumen, documentos cifrados y STL/OBJ.
- RPC cifrada por trozos al PC; sesiones vinculadas a proyecto/dispositivo, resultado cifrado antes de limpiar copias PC, no reenvío automático en recuperación.

## Verificado
- Suite general: 316 pruebas aprobadas, una omitida; prueba adicional de sesiones PC aprobada por separado.
- FFmpeg generó MP4 real con disolver/PiP/keyframes; comprobación adicional de audio/subtítulos exitosa.
- Chromium: CAD guardar/exportar/reload/reabrir con dimensión 30 mm conservada; WAV master procesado y cifrado; video con transición/PiP guardado/reabierto. 360 px sin overflow; sin errores JS.
- Android build.9 compilada realmente: minSdk 30, target 35, SQLCipher ARM64/ARMv7; firma SHA256 igual a build.8. Todos los plugins nativos, incluidos túneles, compilaron.

## Límites y pendientes: no es cierre 100%
- CAD CSG no es kernel B-rep: STEP, restricciones de sketches, fillets paramétricos, rigging/animación y edición de vértices no implementados.
- Limitador sample-peak no certifica true peak; RMS no equivale a LUFS; masterización por IA no implementada.
- Timeline permite orden/recorte/parametrización, pero no arrastre con handles ni preview compuesto en tiempo real.
- Demucs inferencia y transferencia PC completa de medios no verificadas con modelos reales; FFmpeg fue ejecutado localmente en sandbox.
- Android físico/Keystore/SQLCipher/Media3/túneles en ejecución no probados en este turno.
- PC trabajo temporal es plaintext con permisos de usuario; sin cifrado de disco PC garantizado. Se limpia al recoger/cancelar; se retiene para recuperación si no se recoge.
- APK es Debug con firma fija, no Release de tienda.
