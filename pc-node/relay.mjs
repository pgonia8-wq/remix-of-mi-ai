// SOCKS5 (RFC 1928 + RFC 1929) and split-VPN packet relay for MI AI PC Node.
// Both accept only the paired phone's IP and only allowlisted destinations. No public proxy, no admin rights.
import net from "node:net";
import dgram from "node:dgram";
import { createCipheriv, createDecipheriv, timingSafeEqual, hkdfSync, randomBytes } from "node:crypto";

// ---------- CIDR helpers (IPv4) ----------
export const ipToInt = (ip) => { const p = ip.split(".").map(Number); if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return null; return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3]; };
export function parseCidr(c) {
  const m = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(String(c)); if (!m) return null;
  const base = ipToInt(m[1]), bits = Number(m[2]); if (base === null || bits < 8 || bits > 32) return null; // never 0.0.0.0/0
  const mask = bits === 32 ? 0xffffffff : (~((1 << (32 - bits)) - 1)) >>> 0;
  return { base: (base & mask) >>> 0, mask, text: `${m[1]}/${bits}` };
}
export const inCidrs = (ip, cidrs) => { const v = ipToInt(ip); return v !== null && cidrs.some((c) => ((v & c.mask) >>> 0) === c.base); };

// ---------- SOCKS5 ----------
const eq = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
/** allow(host, port) decides each CONNECT; only CONNECT is supported (no BIND/UDP ASSOCIATE). */
export async function startSocks({ host, peerIp, user, pass, allow, onLog }) {
  const srv = net.createServer((sock) => {
    const from = (sock.remoteAddress || "").replace(/^::ffff:/, "");
    if (peerIp && from !== peerIp) { onLog?.({ event: "rechazada", from }); sock.destroy(); return; }
    let buf = Buffer.alloc(0), stage = 0;
    sock.setTimeout(30_000, () => sock.destroy());
    sock.on("error", () => sock.destroy());
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]); if (buf.length > 1024) return sock.destroy();
      if (stage === 0) { if (buf.length < 2 || buf.length < 2 + buf[1]) return; if (buf[0] !== 5) return sock.destroy();
        const methods = buf.subarray(2, 2 + buf[1]); buf = buf.subarray(2 + methods.length);
        if (!methods.includes(2)) { sock.end(Buffer.from([5, 0xff])); return; } sock.write(Buffer.from([5, 2])); stage = 1; }
      if (stage === 1) { if (buf.length < 2) return; const ul = buf[1]; if (buf.length < 3 + ul) return; const pl = buf[2 + ul]; if (buf.length < 3 + ul + pl) return;
        const u = buf.subarray(2, 2 + ul).toString(), p = buf.subarray(3 + ul, 3 + ul + pl).toString(); buf = buf.subarray(3 + ul + pl);
        if (!eq(u, user) || !eq(p, pass)) { onLog?.({ event: "credenciales incorrectas", from }); sock.end(Buffer.from([1, 1])); return; }
        sock.write(Buffer.from([1, 0])); stage = 2; }
      if (stage === 2) { if (buf.length < 5) return; if (buf[0] !== 5) return sock.destroy();
        const cmd = buf[1], at = buf[3]; let h, off;
        if (at === 1) { if (buf.length < 10) return; h = [...buf.subarray(4, 8)].join("."); off = 8; }
        else if (at === 3) { const l = buf[4]; if (buf.length < 7 + l) return; h = buf.subarray(5, 5 + l).toString(); off = 5 + l; }
        else { sock.end(Buffer.from([5, 8, 0, 1, 0, 0, 0, 0, 0, 0])); return; }
        const port = buf.readUInt16BE(off); const rest = buf.subarray(off + 2);
        if (cmd !== 1) { sock.end(Buffer.from([5, 7, 0, 1, 0, 0, 0, 0, 0, 0])); return; }
        if (!allow(h, port)) { onLog?.({ event: "destino denegado", target: `${h}:${port}` }); sock.end(Buffer.from([5, 2, 0, 1, 0, 0, 0, 0, 0, 0])); return; }
        stage = 3; sock.off("data", onData); sock.setTimeout(0);
        const up = net.connect(port, h, () => { sock.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0])); if (rest.length) up.write(rest); sock.pipe(up).pipe(sock); onLog?.({ event: "conexión", target: `${h}:${port}` }); });
        up.on("error", () => { if (!sock.destroyed) sock.end(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0])); }); sock.on("close", () => up.destroy());
      }
    };
    sock.on("data", onData);
  });
  await new Promise((res, rej) => { srv.once("error", rej); srv.listen(0, host, res); });
  return { port: srv.address().port, close: () => new Promise((r) => srv.close(() => r())) };
}

// ---------- Encrypted frame stream (shared with MiaiVpnService.java) ----------
// Frame = u32be length || AES-256-GCM(ciphertext||tag). Nonce = u32be direction (0 phone->node, 1 node->phone) || u64be counter.
const nonce = (dir, n) => { const b = Buffer.alloc(12); b.writeUInt32BE(dir, 0); b.writeBigUInt64BE(BigInt(n), 4); return b; };
export function frameSealer(key, dir) { let n = 0; return (pt) => { const c = createCipheriv("aes-256-gcm", key, nonce(dir, n++)); const ct = Buffer.concat([c.update(pt), c.final(), c.getAuthTag()]); const h = Buffer.alloc(4); h.writeUInt32BE(ct.length); return Buffer.concat([h, ct]); }; }
export function frameOpener(key, dir, onFrame) {
  let n = 0, buf = Buffer.alloc(0);
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 4) {
      const len = buf.readUInt32BE(0); if (len < 16 || len > 70_000) throw new Error("frame");
      if (buf.length < 4 + len) return; const body = buf.subarray(4, 4 + len); buf = buf.subarray(4 + len);
      const d = createDecipheriv("aes-256-gcm", key, nonce(dir, n++)); d.setAuthTag(body.subarray(len - 16));
      onFrame(Buffer.concat([d.update(body.subarray(0, len - 16)), d.final()]));
    }
  };
}

// ---------- IPv4 / TCP / UDP packet helpers ----------
const sum16 = (b, s = 0) => { for (let i = 0; i + 1 < b.length; i += 2) s += b.readUInt16BE(i); if (b.length & 1) s += b[b.length - 1] << 8; return s; };
const fold = (s) => { while (s >> 16) s = (s & 0xffff) + (s >> 16); return (~s) & 0xffff; };
const ipb = (ip) => Buffer.from(ip.split(".").map(Number));
export function buildPacket(proto, src, dst, l4) {
  const ip = Buffer.alloc(20); ip[0] = 0x45; ip.writeUInt16BE(20 + l4.length, 2); ip.writeUInt16BE(0x4000, 6); ip[8] = 64; ip[9] = proto;
  ipb(src).copy(ip, 12); ipb(dst).copy(ip, 16); ip.writeUInt16BE(fold(sum16(ip)), 10);
  const pseudo = Buffer.concat([ipb(src), ipb(dst), Buffer.from([0, proto, l4.length >> 8, l4.length & 0xff])]);
  const off = proto === 6 ? 16 : 6; l4.writeUInt16BE(0, off); let c = fold(sum16(l4, sum16(pseudo))); if (proto === 17 && c === 0) c = 0xffff; l4.writeUInt16BE(c, off);
  return Buffer.concat([ip, l4]);
}
export function tcpSeg(sp, dp, seq, ack, flags, data = Buffer.alloc(0)) {
  const h = Buffer.alloc(20); h.writeUInt16BE(sp, 0); h.writeUInt16BE(dp, 2); h.writeUInt32BE(seq >>> 0, 4); h.writeUInt32BE(ack >>> 0, 8);
  h[12] = 5 << 4; h[13] = flags; h.writeUInt16BE(65535, 14); return Buffer.concat([h, data]);
}
export function parsePacket(p) {
  if (p.length < 20 || p[0] >> 4 !== 4) return null; const ihl = (p[0] & 15) * 4, total = p.readUInt16BE(2);
  const src = [...p.subarray(12, 16)].join("."), dst = [...p.subarray(16, 20)].join("."), proto = p[9], l4 = p.subarray(ihl, total);
  if (proto === 6 && l4.length >= 20) { const doff = (l4[12] >> 4) * 4; return { proto, src, dst, sp: l4.readUInt16BE(0), dp: l4.readUInt16BE(2), seq: l4.readUInt32BE(4), ack: l4.readUInt32BE(8), flags: l4[13], data: l4.subarray(doff) }; }
  if (proto === 17 && l4.length >= 8) return { proto, src, dst, sp: l4.readUInt16BE(0), dp: l4.readUInt16BE(2), data: l4.subarray(8) };
  return { proto, src, dst };
}
const F = { FIN: 1, SYN: 2, RST: 4, PSH: 8, ACK: 16 };
export const TCP_FLAGS = F;

/** Userspace NAT: terminates the phone's TCP/UDP flows and re-originates them from the PC. Destinations must be in `cidrs`. */
export function createNat({ cidrs, send, onLog }) {
  const tcp = new Map(), udp = new Map(); const MSS = 1360, WIN = 256 * 1024;
  const out = (proto, src, dst, l4) => send(buildPacket(proto, src, dst, l4));
  const rst = (p) => out(6, p.dst, p.src, tcpSeg(p.dp, p.sp, p.ack, p.seq + p.data.length + (p.flags & F.SYN ? 1 : 0), F.RST | F.ACK));
  const handleTcp = (p) => {
    const k = `${p.src}:${p.sp}>${p.dst}:${p.dp}`; let c = tcp.get(k);
    if (p.flags & F.RST) { if (c) { c.up.destroy(); tcp.delete(k); } return; }
    if (!c) {
      if (!(p.flags & F.SYN) || p.flags & F.ACK) return rst(p);
      if (!inCidrs(p.dst, cidrs)) { onLog?.({ event: "destino denegado", target: `${p.dst}:${p.dp}` }); return rst(p); }
      c = { my: (Math.random() * 2 ** 32) >>> 0, their: (p.seq + 1) >>> 0, acked: 0, up: null, open: false, finSent: false, finRecv: false };
      c.acked = c.my; tcp.set(k, c);
      const s = (fl, d) => out(6, p.dst, p.src, tcpSeg(p.dp, p.sp, c.my, c.their, fl, d));
      c.s = s;
      c.up = net.connect(p.dp, p.dst, () => { c.open = true; s(F.SYN | F.ACK); c.my = (c.my + 1) >>> 0; onLog?.({ event: "conexión", target: `${p.dst}:${p.dp}` }); });
      c.up.on("data", (d) => { for (let i = 0; i < d.length; i += MSS) { const part = d.subarray(i, i + MSS); s(F.PSH | F.ACK, part); c.my = (c.my + part.length) >>> 0; } if (((c.my - c.acked) >>> 0) > WIN) c.up.pause(); });
      c.up.on("end", () => { if (!c.finSent) { s(F.FIN | F.ACK); c.my = (c.my + 1) >>> 0; c.finSent = true; } if (c.finRecv) tcp.delete(k); });
      c.up.on("error", () => { if (!c.open) rst(p); else s(F.RST | F.ACK); tcp.delete(k); });
      return;
    }
    if (p.flags & F.SYN) return; // retransmitted SYN while connecting
    if (p.flags & F.ACK) { c.acked = p.ack; if (c.up.isPaused() && ((c.my - c.acked) >>> 0) < WIN / 2) c.up.resume(); }
    if (p.data.length) { if (p.seq === c.their && c.open) { c.up.write(p.data); c.their = (c.their + p.data.length) >>> 0; } c.s(F.ACK); }
    if (p.flags & F.FIN && ((p.seq + p.data.length) >>> 0) === c.their) { c.their = (c.their + 1) >>> 0; c.finRecv = true; c.s(F.ACK); c.up.end(); if (c.finSent) tcp.delete(k); }
  };
  const handleUdp = (p) => {
    if (!inCidrs(p.dst, cidrs)) { onLog?.({ event: "destino denegado", target: `${p.dst}:${p.dp}` }); return; }
    const k = `${p.src}:${p.sp}>${p.dst}:${p.dp}`; let u = udp.get(k);
    if (!u) {
      const sock = dgram.createSocket("udp4"); u = { sock, timer: null }; udp.set(k, u);
      sock.on("message", (m) => { const h = Buffer.alloc(8); h.writeUInt16BE(p.dp, 0); h.writeUInt16BE(p.sp, 2); h.writeUInt16BE(8 + m.length, 4); out(17, p.dst, p.src, Buffer.concat([h, m])); });
      sock.on("error", () => { sock.close(); udp.delete(k); });
    }
    clearTimeout(u.timer); u.timer = setTimeout(() => { u.sock.close(); udp.delete(k); }, 30_000);
    u.sock.send(p.data, p.dp, p.dst);
  };
  return {
    input(pkt) { const p = parsePacket(pkt); if (!p) return; if (p.proto === 6 && p.data) handleTcp(p); else if (p.proto === 17 && p.data) handleUdp(p); },
    close() { for (const c of tcp.values()) c.up.destroy(); for (const u of udp.values()) { clearTimeout(u.timer); try { u.sock.close(); } catch { /* closed */ } } tcp.clear(); udp.clear(); },
    stats: () => ({ tcp: tcp.size, udp: udp.size }),
  };
}

export const VPN_HELLO = Buffer.from("miai-vpn-2");
export const VPN_SALT = 32;
/** Per-connection key: HKDF-SHA256(session key, node salt || phone salt). Fresh salts on both sides mean a recorded
 * stream can never be replayed into a new connection, and nonces (direction || counter) are never reused under one key. */
export const vpnSessionKey = (key, nodeSalt, phoneSalt) => Buffer.from(hkdfSync("sha256", key, Buffer.concat([nodeSalt, phoneSalt]), Buffer.from("miai-vpn-2 session"), 32));
/** Single-use listener for the paired phone only. Handshake: node sends a random salt, the phone answers with its own
 * salt plus the first sealed frame (VPN_HELLO) under the derived key. After one authenticated client the listener
 * stops accepting connections, so a captured stream cannot be replayed later within the session lifetime. */
export async function startVpn({ host, peerIp, key, cidrs, onLog }) {
  let active = null, used = false, listening = true;
  const srv = net.createServer((sock) => {
    const from = (sock.remoteAddress || "").replace(/^::ffff:/, "");
    if ((peerIp && from !== peerIp) || active || used) { onLog?.({ event: "rechazada", from }); sock.destroy(); return; }
    active = sock; const nodeSalt = randomBytes(VPN_SALT); sock.write(nodeSalt);
    let pre = Buffer.alloc(0), reader = null, hello = false, nat = null;
    const done = () => { nat?.close(); if (active === sock) active = null; };
    const timer = setTimeout(() => { if (!hello) { onLog?.({ event: "autenticación fallida", from }); sock.destroy(); } }, 15_000);
    sock.on("data", (d) => {
      try {
        if (!reader) {
          pre = Buffer.concat([pre, d]); if (pre.length < VPN_SALT) return;
          const k = vpnSessionKey(key, nodeSalt, pre.subarray(0, VPN_SALT)); const sealOut = frameSealer(k, 1);
          reader = frameOpener(k, 0, (pt) => {
            if (!hello) {
              if (pt.length !== VPN_HELLO.length || !timingSafeEqual(pt, VPN_HELLO)) throw new Error("hello");
              hello = true; used = true; clearTimeout(timer);
              if (listening) { listening = false; srv.close(); } // single use: no further connections are accepted
              nat = createNat({ cidrs, onLog, send: (pkt) => sock.write(sealOut(pkt)) }); sock.write(sealOut(VPN_HELLO)); onLog?.({ event: "vpn conectada", from }); return;
            }
            nat.input(pt);
          });
          const rest = pre.subarray(VPN_SALT); pre = Buffer.alloc(0); if (rest.length) reader(rest); return;
        }
        reader(d);
      } catch { onLog?.({ event: "autenticación fallida", from }); sock.destroy(); }
    });
    sock.on("close", () => { clearTimeout(timer); done(); }); sock.on("error", done);
  });
  await new Promise((res, rej) => { srv.once("error", rej); srv.listen(0, host, res); });
  return { port: srv.address().port, close: () => new Promise((r) => { active?.destroy(); if (!listening) return r(); listening = false; srv.close(() => r()); }) };
}
