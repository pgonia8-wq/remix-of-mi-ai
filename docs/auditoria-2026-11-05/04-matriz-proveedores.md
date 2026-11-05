# Matriz multiproveedor

Todas las verificaciones de proveedor de esta sesión son **locales/simuladas**, ninguna solicitud de pago.

| Adaptador | Declarado/implementado | Prueba disponible | Limitación |
|---|---|---|---|
| OpenAI | Chat, tools, visión, imagen/edición, TTS, STT, traducción, embeddings | core-universal, providers, chat-tools | Cada modelo requiere capacidades propias; no video en este adaptador |
| Azure | Lo anterior + video según deployment | azure-url, core-universal, media-jobs | Contratos por tipo; Cosmos real no confirmado |
| Anthropic/Gemini | Universal text: chat | providers | No inferir multimodalidad universal por marca |
| xAI/DeepSeek/Mistral/compatible | text: chat; ruta interactiva OpenAI-style | providers/chat-tools | Dos rutas de capacidad distintas |
| ElevenLabs | TTS/STT/clonación/música/efectos | contratos locales | Voz propia requiere verificación del executor |
| Tavily | Búsqueda | registro/contratos | No equivale a leer páginas |
| SearXNG | Búsqueda HTTPS JSON | validación local | Instancia real no probada |
| Meshy | 3D + polling | core/jobs | Sin cancelación ni idempotencia remota declarada |
| Runway | Generar/editar video + polling | media-jobs | Cuenta/modelo no probado |

Fuentes: src/lib/core/adapters/{index,openai,azure,elevenlabs,tavily,searxng,meshy,runway}.ts; executor.ts:36-57. No existe matriz completa por deployments configurados en el teléfono: ese inventario no está accesible aquí. Qwen/Kimi/NVIDIA no se certifican por aceptar un tipo compatible. Las claves del usuario no se solicitaron ni exportaron.
