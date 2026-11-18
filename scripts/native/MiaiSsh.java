package com.miai.app;

import com.getcapacitor.PluginCall;
import com.jcraft.jsch.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/** Shared SSH session setup: strict known_hosts, password and/or private key, and honest error messages. */
final class MiaiSsh {
  private MiaiSsh() {}
  static Session open(PluginCall call, boolean keepAlive) throws Exception {
    String host = call.getString("host", ""), user = call.getString("user", ""), known = call.getString("knownHosts", "");
    String password = call.getString("password", ""), key = call.getString("privateKey", ""), passphrase = call.getString("passphrase", "");
    if (!host.matches("[a-zA-Z0-9.:-]{1,253}") || host.equals("0.0.0.0") || user.isEmpty() || user.length() > 100 || known.isEmpty() || known.length() > 16000) throw new IOException("MIAI_CONFIG");
    if (password.isEmpty() && key.isEmpty()) throw new IOException("MIAI_NO_CREDENTIAL");
    JSch jsch = new JSch();
    jsch.setKnownHosts(new ByteArrayInputStream(known.getBytes(StandardCharsets.UTF_8)));
    if (!key.isEmpty()) {
      byte[] k = key.getBytes(StandardCharsets.UTF_8), pp = passphrase.isEmpty() ? null : passphrase.getBytes(StandardCharsets.UTF_8);
      try { jsch.addIdentity("miai-key", k, null, pp); }
      catch (JSchException e) { throw new IOException("MIAI_BAD_KEY"); }
      finally { java.util.Arrays.fill(k, (byte) 0); if (pp != null) java.util.Arrays.fill(pp, (byte) 0); }
    }
    Session s = jsch.getSession(user, host, call.getInt("port", 22));
    if (!password.isEmpty()) s.setPassword(password);
    s.setConfig("StrictHostKeyChecking", "yes");
    // Like Termius: try the key first, then the password.
    s.setConfig("PreferredAuthentications", key.isEmpty() ? "password,keyboard-interactive" : (password.isEmpty() ? "publickey" : "publickey,password,keyboard-interactive"));
    if (keepAlive) s.setServerAliveInterval(15000);
    s.setTimeout(20000); s.connect(20000); return s;
  }

  /** Human explanation of the real failure. Never includes credentials. */
  static String explain(Throwable e, String fallback) {
    String m = String.valueOf(e.getMessage()), low = m.toLowerCase(Locale.ROOT);
    Throwable c = e.getCause();
    if (m.equals("MIAI_CONFIG")) return "Datos de conexión no válidos (host, usuario o clave de host).";
    if (m.equals("MIAI_NO_CREDENTIAL")) return "Falta la contraseña o la clave privada.";
    if (m.equals("MIAI_BAD_KEY")) return "La clave privada no se pudo leer: formato no compatible o frase de paso incorrecta.";
    if (low.contains("reject hostkey") || low.contains("hostkey has been changed") || low.contains("unknownhostkey")) return "La clave de host del servidor no coincide con la guardada. Vuelve a obtenerla con ssh-keyscan y actualiza la conexión.";
    if (low.contains("auth fail") || low.contains("auth cancel") || low.contains("too many authentication")) return "El servidor rechazó el usuario, la contraseña o la clave privada (igual que si Termius dijera «Authentication failed»).";
    if (e instanceof UnknownHostException || c instanceof UnknownHostException || low.contains("unknownhost")) return "No se encontró el servidor. Revisa la IP o el nombre.";
    if (c instanceof ConnectException || low.contains("connection refused")) return "El servidor rechazó la conexión en ese puerto (SSH apagado o puerto incorrecto).";
    if (c instanceof SocketTimeoutException || low.contains("timeout") || low.contains("timed out")) return "No hubo respuesta del servidor a tiempo. Revisa que la regla de red (por ejemplo, el NSG de Azure) permita el puerto 22 desde la red del teléfono.";
    if (c instanceof NoRouteToHostException || low.contains("network is unreachable")) return "Sin ruta hacia el servidor desde la red del teléfono.";
    if (low.contains("algorithm negotiation fail")) return "El teléfono y el servidor no acordaron un algoritmo SSH compatible.";
    if (m.equals("Output cap")) return "La salida superó 1 MB.";
    if (m.equals("Timeout")) return "El comando tardó más del máximo permitido; puede seguir corriendo en el servidor.";
    String safe = m.replaceAll("[\\r\\n]+", " ");
    return fallback + (safe.length() > 0 && !safe.equals("null") ? " Detalle: " + safe.substring(0, Math.min(200, safe.length())) : "");
  }
}
