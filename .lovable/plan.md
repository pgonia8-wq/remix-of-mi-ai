# Bloque 1 — siguiente tramo

## Qué se construye
1. **Presupuesto conectado a las llamadas reales**: cada llamada de chat, imagen, audio y video registra su costo (exacto si el proveedor lo informa, si no "estimado" con tarifa conocida, o "sin precio" si no hay tarifa). Antes de llamar: aviso al 80% y bloqueo al 100% con un botón para confirmar esa llamada concreta. Pantalla de gasto del mes por proyecto.
2. **Respaldos por partes**: el respaldo completo se escribe archivo por archivo en trozos cifrados con verificación de cada trozo, para no agotar la memoria en teléfonos modestos. Los respaldos anteriores siguen pudiéndose abrir.
3. **Restauración y rotación de llaves reanudables**: un registro de avance permite, si la app se cierra a mitad, reanudar o revertir al abrir; nunca queda una mezcla.
4. **Riesgos R01–R20**: corregir los que se reproduzcan con pruebas; los que dependan de Android real quedan anotados.

## Verificación
- Pruebas por regla: bloqueo al 100%, confirmación de una sola llamada, aislamiento por proyecto, reanudación tras corte, compatibilidad con respaldos v2.
- Revisión en la vista previa móvil; Android pendiente hasta el Bloque 5.

## Detalles técnicos
- Tarifas en una tabla local editable por modelo; el registro de costos se escribe tras cada respuesta, en el ejecutor compartido, sin claves.
- Respaldo v3: encabezado autenticado + registros AES-GCM por trozo con índice y bandera de final (como AssetStore); v2 sigue legible.
- Tabla `restore_journal` con estados started/applied/committed; recuperación al iniciar el núcleo.
