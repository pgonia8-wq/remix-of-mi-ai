package com.miai.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.net.VpnService;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import android.util.Base64;
import java.io.*;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Split VPN: only the chosen private subnets are routed into the tunnel; all other traffic is untouched.
 * Packets travel to the paired PC Node over TCP framed with AES-256-GCM (frame format shared with pc-node/relay.mjs).
 */
public class MiaiVpnService extends VpnService {
  static volatile String state = "detenida"; static volatile String lastError = "";
  static volatile long expiresAt = 0;
  private static volatile MiaiVpnService instance;
  private ParcelFileDescriptor tun; private Socket sock; private Thread up, down;
  private static final byte[] HELLO = "miai-vpn-1".getBytes();

  static void stopNow(String why) { MiaiVpnService s = instance; if (s != null) s.shutdown(why); }

  @Override public int onStartCommand(Intent i, int flags, int startId) {
    if (i == null) { stopSelf(); return START_NOT_STICKY; } // never restarts by itself
    instance = this;
    final String host = i.getStringExtra("host"); final int port = i.getIntExtra("port", 0);
    final byte[] key = Base64.decode(i.getStringExtra("key"), Base64.DEFAULT); final String[] subnets = i.getStringArrayExtra("subnets");
    final long ttl = i.getLongExtra("ttlMs", 600000L); expiresAt = System.currentTimeMillis() + ttl;
    startForegroundNotice();
    new Thread(() -> run(host, port, key, subnets, ttl)).start();
    return START_NOT_STICKY;
  }
  private void startForegroundNotice() {
    String ch = "miai_vpn";
    if (Build.VERSION.SDK_INT >= 26) ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(new NotificationChannel(ch, "VPN de MI AI", NotificationManager.IMPORTANCE_LOW));
    Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, ch) : new Notification.Builder(this);
    Notification n = b.setContentTitle("VPN de MI AI activa").setContentText("Solo las subredes autorizadas pasan por tu PC").setSmallIcon(android.R.drawable.ic_lock_lock).setOngoing(true).build();
    if (Build.VERSION.SDK_INT >= 34) startForeground(7101, n, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE); else startForeground(7101, n);
  }
  private static byte[] nonce(int dir, long n) { return ByteBuffer.allocate(12).putInt(dir).putLong(n).array(); }

  private void run(String host, int port, byte[] key, String[] subnets, long ttl) {
    try {
      state = "conectando";
      Builder b = new Builder().setSession("MI AI").setMtu(1400).addAddress("10.88.0.2", 32).setBlocking(true);
      for (String s : subnets) { String[] p = s.split("/"); int bits = Integer.parseInt(p[1]); if (bits < 8 || bits > 32) throw new IOException("subred"); b.addRoute(p[0], bits); }
      b.addDisallowedApplication(getPackageName()); // our own control traffic never loops into the tunnel
      sock = new Socket(); protect(sock); sock.setTcpNoDelay(true); sock.connect(new InetSocketAddress(host, port), 15000);
      final SecretKeySpec k = new SecretKeySpec(key, "AES"); Arrays.fill(key, (byte) 0);
      final DataOutputStream out = new DataOutputStream(new BufferedOutputStream(sock.getOutputStream()));
      final DataInputStream in = new DataInputStream(new BufferedInputStream(sock.getInputStream()));
      final long[] ctrOut = {0}; long ctrIn = 0;
      final Object lock = new Object();
      Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
      synchronized (lock) { c.init(Cipher.ENCRYPT_MODE, k, new GCMParameterSpec(128, nonce(0, ctrOut[0]++))); byte[] ct = c.doFinal(HELLO); out.writeInt(ct.length); out.write(ct); out.flush(); }
      Cipher d = Cipher.getInstance("AES/GCM/NoPadding");
      int len = in.readInt(); if (len < 16 || len > 70000) throw new IOException("frame"); byte[] buf = new byte[len]; in.readFully(buf);
      d.init(Cipher.DECRYPT_MODE, k, new GCMParameterSpec(128, nonce(1, ctrIn++))); if (!Arrays.equals(d.doFinal(buf), HELLO)) throw new IOException("hello");
      tun = b.establish(); if (tun == null) throw new IOException("Permiso VPN no concedido");
      state = "activa";
      final FileInputStream tin = new FileInputStream(tun.getFileDescriptor()); final FileOutputStream tout = new FileOutputStream(tun.getFileDescriptor());
      up = new Thread(() -> {
        byte[] pkt = new byte[1500];
        try { Cipher e = Cipher.getInstance("AES/GCM/NoPadding");
          while (!Thread.interrupted()) { int n = tin.read(pkt); if (n <= 0) continue;
            synchronized (lock) { e.init(Cipher.ENCRYPT_MODE, k, new GCMParameterSpec(128, nonce(0, ctrOut[0]++))); byte[] ct = e.doFinal(pkt, 0, n); out.writeInt(ct.length); out.write(ct); out.flush(); } }
        } catch (Exception ex) { shutdown("conexión perdida"); }
      });
      up.start();
      new Thread(() -> { try { Thread.sleep(ttl); } catch (InterruptedException ignored) {} shutdown("expirada"); }).start();
      while (true) { int l = in.readInt(); if (l < 16 || l > 70000) throw new IOException("frame"); byte[] f = new byte[l]; in.readFully(f);
        d.init(Cipher.DECRYPT_MODE, k, new GCMParameterSpec(128, nonce(1, ctrIn++))); tout.write(d.doFinal(f)); }
    } catch (Exception e) { lastError = e.getMessage() == null ? "error" : e.getMessage(); shutdown("error: " + lastError); }
  }
  synchronized void shutdown(String why) {
    if (state.startsWith("detenida")) return; state = "detenida (" + why + ")"; expiresAt = 0;
    try { if (sock != null) sock.close(); } catch (IOException ignored) {}
    try { if (tun != null) tun.close(); } catch (IOException ignored) {}
    if (up != null) up.interrupt();
    stopForeground(true); stopSelf(); instance = null;
  }
  @Override public void onRevoke() { shutdown("revocada por Android"); }
  @Override public void onDestroy() { shutdown("servicio detenido"); super.onDestroy(); }
}
