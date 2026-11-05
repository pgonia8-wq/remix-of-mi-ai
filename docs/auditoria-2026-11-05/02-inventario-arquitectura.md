# Inventario y mapa real

29 archivos de ruta TSX, 28 pantallas sin __root; 133 archivos TS bajo src/lib; 7 directorios funcionales; 92 dependencias de producción, 25 de desarrollo; 54 archivos de pruebas.

## Mapa de datos
```text
Pantallas TanStack / React
  → use-app / Repo / SqlDb
      → Android: SQLCipher + almacén de claves nativo
      → preview: sql.js + almacenamiento web exclusivamente de desarrollo
  → getCore / registry / router / executor / adapters
      → solicitudes desde dispositivo → proveedores externos
      → jobs + ID remoto → consulta → AssetStore → Repo → Biblioteca
  → chatToolSet → runChatTool → invokeTool
      → herramientas locales / proveedores / PC Node / SSH
      → agents.delegate → createRun → driveRun → stepRun
          → tareas / checkpoints / evidencia → AutoRunInline / autonomía
```

Chat: selección→adjuntos/contexto→streamChat→herramientas→borrador/Repo→mensaje/UI→estado interrupted/Continuar. Ref: src/routes/chat.$chatId.tsx:81-245; src/lib/chat-draft.ts; src/lib/db/repo.ts:230-272.

Respaldo: Ajustes→backup-stream→Repo.dumpAll→archivo cifrado→verificación→promoción de archivos→restoreAll→recuperación de journal. Refs: src/routes/settings.tsx:103-143; src/lib/core/backup-stream.ts:37,124-154; repo.ts:435-477. Omisión de tablas documentada en F01.

PC Node es servicio real en pc-node/miai-node.mjs; VM significa PC Node o conexión SSH en una máquina externa, no aprovisionamiento automático. Teléfono es entorno predeterminado. Android se genera con scripts/android-prepare.sh; no había android/ ni APK/AAB en el checkout.

No se afirma haber pulsado cada acción ni inventariado cada contrato: el listado de rutas es completo para TSX; el mapa funcional es selectivo.
