# MI AI — Fase 1: Núcleo funcional (mobile-first, local-first)

El documento describe una plataforma enorme (multiagente, video, 3D, ejecución de código, APK). Construirla de una sola vez no es realista; propongo una Fase 1 real y funcional que sirve de base para todo lo demás.

## Lo que tendrás al terminar la Fase 1
1. **Proyectos aislados**: crear proyectos (TRAMA, HTP, etc.). Cada proyecto tiene sus chats, memoria y documentos; un proyecto nunca ve datos de otro. Los chats del mismo proyecto comparten conocimiento.
2. **Conexiones de proveedores**: añadir/editar/desactivar/probar conexiones (OpenAI, Anthropic, Gemini, Azure AI Foundry, xAI, DeepSeek, Mistral, Cohere, compatible OpenAI, endpoint personalizado) con nombre, endpoint, API key, deployment, modelo, versión, parámetros extra. Claves guardadas cifradas en el dispositivo, nunca en el código.
3. **Chat con streaming** usando la conexión elegida; cambiar de modelo a mitad de conversación sin perder historial.
4. **Memoria persistente por proyecto**: notas de memoria (hechos, decisiones, hipótesis) consultables, editables y versionadas; se inyectan como contexto en cada chat del proyecto.
5. **Documentos del proyecto**: subir texto/PDF/markdown, búsqueda local, uso como contexto.
6. **Funciona sin Internet** para consultar chats, proyectos, memoria y ajustes.
7. **Exportar/importar** todo en un archivo cifrado con contraseña.
8. **Preparado para Android**: configuración de Capacitor incluida y guía para compilar la APK en Android Studio (la APK se compila fuera de Lovable).

## Fuera de la Fase 1 (fases siguientes)
Multiagentes y modo automático de selección de modelo, imágenes/video/audio, investigación web, ejecución de código, generación de documentos/presentaciones, conectores externos.

## Diseño
Oscuro, sobrio, tipo herramienta profesional: navegación inferior (Proyectos, Chats, Memoria, Ajustes), tipografía Space Grotesk + DM Sans, acento ámbar.

## Detalles técnicos
- Sin backend obligatorio: datos en IndexedDB (Dexie) en la capa web; capa de almacenamiento abstraída para cambiar a SQLite/SQLCipher nativo vía Capacitor más adelante.
- Claves cifradas con WebCrypto (AES-GCM) con PIN/contraseña del usuario; en Android se migrará a Keystore mediante plugin.
- Llamadas a proveedores directamente desde el dispositivo, un adaptador por proveedor (auth, formato de mensajes, streaming SSE, errores).
- Rutas: `/` proyectos, `/p/$id` chats del proyecto, `/p/$id/c/$chatId` chat, `/p/$id/memory`, `/p/$id/docs`, `/settings/providers`, `/settings/backup`.
- Todas las consultas filtran por `projectId` para garantizar aislamiento.
- `capacitor.config.ts` + `ANDROID.md` documentando qué es web y qué es nativo.
- Nota: algunos proveedores (p. ej. Anthropic) bloquean CORS desde navegador; en la APK no aplica, en vista previa web se indicará el error claramente.
