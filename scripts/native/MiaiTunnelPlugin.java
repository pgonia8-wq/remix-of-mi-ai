package com.miai.app;

import android.app.AlertDialog;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.jcraft.jsch.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.*;
import java.util.concurrent.*;

/**
 * SSH local/reverse forwarding and SSH-backed SOCKS5 for MI AI.
 * Rules: strict known_hosts, native confirmation per tunnel, binds only to 127.0.0.1 (phone) or
 * 127.0.0.1 on the server (reverse), allowlisted SOCKS destinations, random per-session SOCKS credentials, TTL.
 */
@CapacitorPlugin(name = "MiaiTunnel")
public class MiaiTunnelPlugin extends Plugin {
  private final ExecutorService executor = Executors.newCachedThreadPool();
  private final ScheduledExecutorService timers = Executors.newSingleThreadScheduledExecutor();
  private final Map<String, Fwd> active = new ConcurrentHashMap<>();
  private static final SecureRandom RNG = new SecureRandom();

  private static class Fwd {
    String id, kind, desc; Session session; ServerSocket socks; long expiresAt; ScheduledFuture<?> timer;
    final List<String> log = Collections.synchronizedList(new ArrayList<>());
    void add(String e) { synchronized (log) { log.add(System.currentTimeMillis() + " " + e); if (log.size() > 200) log.remove(0); } }
  }

  private void approve(PluginCall call, String what, Runnable task) {
    getActivity().runOnUiThread(() -> new AlertDialog.Builder(getActivity())
      .setTitle("Autorizar túnel")
      .setMessage(call.getString("user", "") + "@" + call.getString("host", "") + "\n" + what
        + "\nDuración: " + (ttl(call) / 60000) + " min\n\nClave de host confiada:\n" + call.getString("knownHosts", "")
        + "\n\nEl túnel solo escucha en este teléfono (o en el localhost del servidor) y se cierra al vencer.")
      .setNegativeButton("Cancelar", (d, w) -> call.reject("Túnel cancelado"))
      .setPositiveButton("Autorizar", (d, w) -> executor.execute(task))
      .setOnCancelListener(d -> call.reject("Túnel cancelado")).show());
  }
  private static long ttl(PluginCall call) { long t = call.getLong("ttlMs", 600000L); return Math.max(10000L, Math.min(t, 7200000L)); }
  private static boolean validHost(String h) { return h != null && h.matches("[a-zA-Z0-9.:-]{1,253}") && !h.equals("0.0.0.0"); }
  private static boolean validPort(int p) { return p > 0 && p < 65536; }

  private Session session(PluginCall call) throws Exception { return MiaiSsh.open(call, true); }
  private Fwd register(String kind, String desc, Session s, long ttl) {
    Fwd f = new Fwd(); f.id = UUID.randomUUID().toString(); f.kind = kind; f.desc = desc; f.session = s; f.expiresAt = System.currentTimeMillis() + ttl;
    f.timer = timers.schedule(() -> close(f.id, "expirado"), ttl, TimeUnit.MILLISECONDS); f.add("abierto " + desc); active.put(f.id, f); return f;
  }
  private void close(String id, String why) {
    Fwd f = active.remove(id); if (f == null) return; f.add(why);
    if (f.timer != null) f.timer.cancel(false);
    try { if (f.socks != null) f.socks.close(); } catch (Exception ignored) {}
    if (f.session != null) f.session.disconnect();
    JSObject ev = new JSObject(); ev.put("id", id); ev.put("reason", why); notifyListeners("closed", ev);
  }
  private JSObject result(Fwd f, int port) { JSObject r = new JSObject(); r.put("id", f.id); r.put("port", port); r.put("expiresAt", f.expiresAt); return r; }

  @PluginMethod public void forwardLocal(PluginCall call) {
    String th = call.getString("targetHost", ""); int tp = call.getInt("targetPort", 0);
    if (!validHost(th) || !validPort(tp)) { call.reject("Destino no válido"); return; }
    approve(call, "Reenvío local: 127.0.0.1 (teléfono) → " + th + ":" + tp + " (desde el servidor)", () -> {
      Session s = null;
      try { s = session(call); int lp = s.setPortForwardingL("127.0.0.1", 0, th, tp); call.resolve(result(register("ssh.local", th + ":" + tp, s, ttl(call)), lp)); }
      catch (Exception e) { if (s != null) s.disconnect(); call.reject(MiaiSsh.explain(e, "No se pudo abrir el reenvío (¿el servidor permite AllowTcpForwarding?).")); }
    });
  }

  @PluginMethod public void forwardRemote(PluginCall call) {
    int rp = call.getInt("remotePort", 0); String th = call.getString("targetHost", "127.0.0.1"); int tp = call.getInt("targetPort", 0);
    if (!validPort(rp) || rp < 1024 || !validHost(th) || !validPort(tp)) { call.reject("Puertos no válidos (el remoto debe ser ≥1024)"); return; }
    approve(call, "Reenvío inverso: 127.0.0.1:" + rp + " (en el servidor) → " + th + ":" + tp + " (desde el teléfono)", () -> {
      Session s = null;
      try { s = session(call); s.setPortForwardingR("127.0.0.1", rp, th, tp); call.resolve(result(register("ssh.reverse", "srv:" + rp + "→" + th + ":" + tp, s, ttl(call)), rp)); }
      catch (Exception e) { if (s != null) s.disconnect(); call.reject("El servidor rechazó el reenvío inverso (puerto ocupado o reenvío deshabilitado)."); }
    });
  }

  /** SOCKS5 server on 127.0.0.1 that only CONNECTs to allowlisted host:port, through SSH direct-tcpip channels. */
  @PluginMethod public void socksDynamic(PluginCall call) {
    JSArray allowArr = call.getArray("allow", new JSArray()); final Set<String> allow = new HashSet<>();
    try { for (int i = 0; i < allowArr.length() && i < 50; i++) { String a = allowArr.getString(i); if (a.matches("[a-zA-Z0-9.-]{1,253}:\\d{1,5}")) allow.add(a.toLowerCase(Locale.ROOT)); } } catch (Exception ignored) {}
    if (allow.isEmpty()) { call.reject("Indica al menos un destino permitido (host:puerto)"); return; }
    approve(call, "SOCKS5 en 127.0.0.1 del teléfono, solo hacia: " + String.join(", ", allow), () -> {
      Session s = null;
      try {
        s = session(call);
        ServerSocket ss = new ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"));
        String user = token(9), pass = token(18);
        Fwd f = register("socks5", "SOCKS→" + String.join(",", allow), s, ttl(call)); f.socks = ss;
        final Session sess = s;
        executor.execute(() -> { while (!ss.isClosed()) { try { Socket c = ss.accept(); executor.execute(() -> socksClient(f, sess, c, allow, user, pass)); } catch (IOException e) { break; } } });
        JSObject r = result(f, ss.getLocalPort()); r.put("user", user); r.put("pass", pass); call.resolve(r);
      } catch (Exception e) { if (s != null) s.disconnect(); call.reject(MiaiSsh.explain(e, "No se pudo iniciar SOCKS sobre SSH.")); }
    });
  }
  private static String token(int n) { byte[] b = new byte[n]; RNG.nextBytes(b); return android.util.Base64.encodeToString(b, android.util.Base64.NO_WRAP | android.util.Base64.URL_SAFE | android.util.Base64.NO_PADDING); }
  private static boolean same(String a, String b) { return MessageDigest.isEqual(a.getBytes(StandardCharsets.UTF_8), b.getBytes(StandardCharsets.UTF_8)); }
  private void socksClient(Fwd f, Session s, Socket c, Set<String> allow, String user, String pass) {
    ChannelDirectTCPIP ch = null;
    try {
      c.setSoTimeout(30000); DataInputStream in = new DataInputStream(c.getInputStream()); OutputStream out = c.getOutputStream();
      if (in.readUnsignedByte() != 5) throw new IOException(); int nm = in.readUnsignedByte(); boolean pw = false;
      for (int i = 0; i < nm; i++) if (in.readUnsignedByte() == 2) pw = true;
      if (!pw) { out.write(new byte[]{5, (byte) 0xff}); throw new IOException(); } out.write(new byte[]{5, 2});
      in.readUnsignedByte(); byte[] u = new byte[in.readUnsignedByte()]; in.readFully(u); byte[] p = new byte[in.readUnsignedByte()]; in.readFully(p);
      if (!same(new String(u, StandardCharsets.UTF_8), user) || !same(new String(p, StandardCharsets.UTF_8), pass)) { out.write(new byte[]{1, 1}); f.add("credenciales incorrectas"); throw new IOException(); }
      out.write(new byte[]{1, 0});
      if (in.readUnsignedByte() != 5) throw new IOException(); int cmd = in.readUnsignedByte(); in.readUnsignedByte(); int at = in.readUnsignedByte(); String host;
      if (at == 1) { byte[] a = new byte[4]; in.readFully(a); host = (a[0] & 255) + "." + (a[1] & 255) + "." + (a[2] & 255) + "." + (a[3] & 255); }
      else if (at == 3) { byte[] h = new byte[in.readUnsignedByte()]; in.readFully(h); host = new String(h, StandardCharsets.US_ASCII); }
      else { out.write(new byte[]{5, 8, 0, 1, 0, 0, 0, 0, 0, 0}); throw new IOException(); }
      int port = in.readUnsignedShort();
      if (cmd != 1) { out.write(new byte[]{5, 7, 0, 1, 0, 0, 0, 0, 0, 0}); throw new IOException(); }
      if (!allow.contains((host + ":" + port).toLowerCase(Locale.ROOT))) { out.write(new byte[]{5, 2, 0, 1, 0, 0, 0, 0, 0, 0}); f.add("destino denegado " + host + ":" + port); throw new IOException(); }
      ch = (ChannelDirectTCPIP) s.openChannel("direct-tcpip"); ch.setHost(host); ch.setPort(port); ch.setOrgIPAddress("127.0.0.1"); ch.setOrgPort(c.getPort());
      ch.setInputStream(c.getInputStream()); ch.setOutputStream(out); c.setSoTimeout(0);
      out.write(new byte[]{5, 0, 0, 1, 0, 0, 0, 0, 0, 0}); out.flush(); ch.connect(15000); f.add("conexión " + host + ":" + port);
      while (!ch.isClosed() && active.containsKey(f.id) && !c.isClosed()) Thread.sleep(200);
    } catch (Exception ignored) {
    } finally { if (ch != null) ch.disconnect(); try { c.close(); } catch (IOException ignored) {} }
  }

  @PluginMethod public void closeForward(PluginCall call) { close(call.getString("id", ""), "cerrado"); call.resolve(); }
  @PluginMethod public void listForwards(PluginCall call) {
    JSArray arr = new JSArray();
    for (Fwd f : active.values()) { JSObject o = new JSObject(); o.put("id", f.id); o.put("kind", f.kind); o.put("desc", f.desc); o.put("expiresAt", f.expiresAt); o.put("connected", f.session != null && f.session.isConnected()); synchronized (f.log) { o.put("log", new JSArray(f.log)); } arr.put(o); }
    JSObject r = new JSObject(); r.put("forwards", arr); call.resolve(r);
  }
  @Override protected void handleOnDestroy() { for (String id : new ArrayList<>(active.keySet())) close(id, "app cerrada"); }
}
