# Continuar Bloque 1 — seguridad y núcleo

Ya hecho: archivar, restaurar y duplicar proyectos.

## Qué se construye ahora (en este orden)
1. **Exportar e importar un solo proyecto** a un archivo cifrado con contraseña propia; al importar se crea un proyecto nuevo (nunca mezcla con otro). Contraseña incorrecta se rechaza sin crear nada. Sin claves API.
2. **Respaldos por partes**: el respaldo completo se escribe y lee en trozos para no agotar la memoria en teléfonos modestos (Poco C40); verificación de integridad antes de restaurar.
3. **Restauración y rotación de llaves reanudables**: si la app se cierra a mitad, al abrir se detecta el estado y se reanuda o revierte; nunca queda una mezcla.
4. **Costos y presupuestos por proyecto**: registro de costo estimado por llamada (marcado "estimado" cuando el proveedor no informa precio), tope mensual por proyecto, aviso al 80% y bloqueo al 100% con opción de confirmar manualmente.
5. **Riesgos R01–R20 de la auditoría**: corregir los que se puedan reproducir con pruebas; los que dependan de Android real quedan anotados como pendientes de dispositivo.

## Verificación
- Pruebas unitarias por cada regla (contraseña errónea, aislamiento de proyecto, reanudación tras corte, tope de presupuesto).
- Revisión en la vista previa móvil; Android sin probar hasta el Bloque 5.

## Detalles técnicos
- Todo pasa por `Repo` con `projectId`; tablas nuevas aditivas (`project_budgets`, `cost_ledger`, `restore_journal`).
- Formato de exportación de proyecto reutiliza el respaldo v2 (Argon2id/PBKDF2, AES-GCM) con alcance de un proyecto y DEK re-envueltas para sus archivos.
- Journal de restauración/rotación con estados `started/applied/committed`; recuperación al iniciar.
- Sin compilar APK hasta el Bloque 5.
