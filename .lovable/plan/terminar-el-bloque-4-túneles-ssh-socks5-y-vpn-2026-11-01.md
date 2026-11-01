# Terminar el Bloque 4: túneles SSH, SOCKS5 y VPN

Los tres tipos de túnel pendientes se construyen ahora, con las mismas reglas que el túnel de PC: permiso por proyecto, destinos permitidos, límite de tiempo, registro, cierre manual y recuperación. Nada queda como proxy abierto.

## Qué tendrás
1. **SSH reenvío local**: un puerto del teléfono (solo accesible desde el propio teléfono) lleva a un servicio del servidor SSH (por ejemplo, la base de datos de tu VPS).
2. **SSH reenvío inverso**: el servidor SSH abre un puerto (solo en su propio localhost) que lleva a un servicio del teléfono o de la PC autorizada.
3. **SOCKS5**: dos formas, ambas con lista de destinos permitidos:
   - en el teléfono, salida a través de un servidor SSH (SOCKS dinámico);
   - en el PC Node, para que el teléfono navegue servicios de la red de la PC.
   Escucha solo en el propio equipo y con usuario/clave aleatorios por sesión. Los destinos fuera de la lista se rechazan.
4. **VPN**: VPN de Android que solo dirige al túnel cifrado del PC Node el tráfico de las subredes que elijas (por ejemplo 192.168.1.0/24 de tu casa). El resto de las apps y de Internet no pasa por ella. Android muestra su aviso propio y el icono de llave mientras está activa.

Cada apertura pide tu confirmación (ventana nativa para SSH/VPN), queda en el historial del proyecto y se cierra al vencer su tiempo, al revocar el nodo o al borrar el proyecto.

## Límites honestos
- Solo funcionan dentro de la APK (no en la vista previa web): la vista previa los mostrará como "solo Android".
- Probaré la lógica y el PC Node aquí; el reenvío SSH real, el SOCKS en el teléfono y la VPN solo se pueden comprobar en tu Poco C40 cuando compilemos (bloque 5).
- La VPN es "dividida" (solo subredes elegidas), no una VPN de privacidad para todo el tráfico.

## Detalles técnicos
- `scripts/android-prepare.sh`: amplía el plugin `MiaiRemote` (JSch 2.28.2 ya incluido) con `forwardLocal`, `forwardRemote`, `socksDynamic` (servidor SOCKS5 propio en 127.0.0.1 con autenticación RFC 1929 y allowlist, encaminado por canales `direct-tcpip`), `closeForward`, `listForwards`; known_hosts estricto y confirmación nativa existentes. Añade `MiaiVpnService` (VpnService, permiso `BIND_VPN_SERVICE`, rutas solo de subredes elegidas, paquetes IP encapsulados por un flujo TCP cifrado hacia el PC Node), plugin `MiaiVpn` con `prepare/start/stop/status`.
- `pc-node/miai-node.mjs`: `socks.open` (SOCKS5 con auth y allowlist, solo IP del teléfono, TTL) y `vpn.open` (endpoint de encapsulación cifrado con la sesión ECDH; reenvío userspace TCP/UDP-DNS solo hacia subredes compartidas con `--vpn-subnet`; sin cambiar rutas del sistema ni requerir administrador).
- `src/lib/nodes/tunnels.ts`: `TUNNEL_KINDS` disponibles según plataforma (`Capacitor.isNativePlatform()`), apertura por tipo, recuperación al iniciar (marca túneles nativos huérfanos como cerrados, sin reabrir solos), cierre en revocación/borrado.
- `src/lib/automation/tools.ts`: `tunnel.open` acepta los nuevos tipos, siempre con aprobación por acción exacta.
- `src/routes/autonomy.tsx`: selector de tipo y campos (conexión SSH, puertos, subredes) en la sección existente, sin rediseño.
- Pruebas: políticas/allowlist/TTL/aislamiento por proyecto; SOCKS5 y VPN del PC Node reales en loopback (handshake, auth, rechazo de destinos); simulación del plugin nativo marcada como tal.
- Actualizar `AGENTS.md` anidados, informe del Bloque 4 y `roadmap.md`.
