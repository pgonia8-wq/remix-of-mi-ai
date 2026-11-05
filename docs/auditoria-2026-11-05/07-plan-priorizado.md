# Plan priorizado de corrección — pendiente de autorización

No hay autorización para modificar código en el archivo recibido: diagnóstico primero. Cada lote deja funcionando la app, incluye caso que falla antes, prueba posterior y revisión UI.

1. **Datos:** F01/F02/F03/F10. Completar política de respaldo sin secretos, preservar configuración y recuperación, hacer operaciones atómicas y enlaces durables. Confirmar restore cifrado en entorno desechable, comparación de tablas/archivos y rollback por fallos. F09 depende de enlaces.
2. **Costos y selección:** F04/F06. Revalidar manual antes de credenciales y registrar/gatear cada llamada; pruebas de varios turnos, fallo y límite intermedio; no llamadas pagadas.
3. **Autonomía:** F05/F07/F08. Destino explícito, preflight modelos, finalización solo con evidencia; probar PC/SSH env sin conexión y 30 turnos controlados, revisar tarjetas.
4. **Medios diferidos:** F09. Mensaje-job-asset persistente, recuperar/poll sin reenviar; cierre/reapertura y descargas byteidénticas con trabajo simulado. Prueba real aparte con presupuesto.
5. **Seguridad:** S01/S02. Solamente hallazgos del scanner; matcher acotado y upgrades compatibles individuales. Suite y nuevo escaneo; no afirmar seguridad total.
6. **Distribución:** F11/F12. Identidad/versiones, firma release elegida, AAB, política oficial Play vigente; comprobar binarios/hashes/firma. No publicar sin autorización.
7. **Validación externa:** APK físico, pantalla bloqueada/cierre, Bluetooth, Azure/DeepSeek/Qwen/Kimi/Cosmos y PC/VM. Presupuesto/acciones concretas autorizados, nunca prueba masiva pagada.

Antes del primer lote: conservar baseline verificable de código sin secretos ni signing, manifiesto/hash y diff; rama de auditoría solo si plataforma permite. Aquí git de escritura está gestionado por plataforma: no se creó rama. Commit limpio y manifiesto de hashes actuales conservados; no son una copia independiente para restauración. Ningún código fue cambiado, por lo que no hay diff de corrección.
