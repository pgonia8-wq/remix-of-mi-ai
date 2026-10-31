# MI AI — Especificación maestra (resumen consolidado)

MI AI es una APK Android privada y local-first. Usa las API de los proveedores con las credenciales del usuario; no hay servidor central obligatorio.

## Principios
- No se elimina ni reescribe funcionalidad existente; los cambios son aditivos.
- Las capacidades son datos (`capabilities`), no código fijo. Un modelo solo se usa para lo que declara.
- El router nunca envía una solicitud a un modelo incompatible y explica su elección.
- Cada operación costosa es un trabajo persistente con clave de idempotencia; si el estado es incierto tras un cierre, queda en `recovery_required` y no se reintenta solo.
- Todo contenido generado se guarda cifrado por proyecto, con etiquetas, relaciones y versiones.

## Seguridad
- AES-256-GCM, DEK aleatoria por archivo, envuelta por una llave maestra versionada no exportable en Android Keystore (StrongBox si existe).
- Nonce de 96 bits = prefijo aleatorio por archivo + contador; encabezado autenticado como AAD; registro final autenticado (también en archivos vacíos) que detecta truncamiento.
- Respaldos con Argon2id (memoria ajustada al equipo) o PBKDF2-HMAC-SHA256 ≥ 600 000 iteraciones; las DEK se re-envuelven con la llave de la copia para restaurar en otro teléfono. Las API keys nunca se exportan.
- No se afirma protección absoluta en un dispositivo comprometido.

## Fases
1. Núcleo universal (registro, router, trabajos, biblioteca cifrada, respaldos, imagen y audio iniciales)
2. Imagen y visión · 3. Audio y voz · 4. Documentos y productividad · 5. Investigación y educación · 6. Agentes, automatización y código · 7. Espacio profesional · 8. Música · 9. Video y 3D

El detalle por capacidad está en `INVENTARIO-CAPACIDADES.md`.
