package com.miai.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.net.VpnService;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.*;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Starts/stops the split VPN after an in-app confirmation plus Android's own VPN consent. */
@CapacitorPlugin(name = "MiaiVpn")
public class MiaiVpnPlugin extends Plugin {
  @PluginMethod public void start(PluginCall call) {
    JSArray subs = call.getArray("subnets", new JSArray());
    String host = call.getString("host", ""), key = call.getString("key", ""); int port = call.getInt("port", 0);
    if (!host.matches("[0-9.]{7,15}") || port <= 0 || port > 65535 || key.length() < 40 || subs.length() == 0 || subs.length() > 8) { call.reject("Configuración VPN no válida"); return; }
    String list; try { list = String.join(", ", subs.<String>toList()); } catch (Exception e) { call.reject("Subredes no válidas"); return; }
    getActivity().runOnUiThread(() -> new AlertDialog.Builder(getActivity())
      .setTitle("Activar VPN hacia tu PC")
      .setMessage("Solo el tráfico hacia " + list + " pasará por la PC " + host + ".\nInternet y las demás redes no se desvían.\nDuración: " + (call.getLong("ttlMs", 600000L) / 60000) + " min.")
      .setNegativeButton("Cancelar", (d, w) -> call.reject("VPN cancelada"))
      .setPositiveButton("Continuar", (d, w) -> {
        Intent consent = VpnService.prepare(getContext());
        if (consent != null) startActivityForResult(call, consent, "consent"); else launch(call);
      })
      .setOnCancelListener(d -> call.reject("VPN cancelada")).show());
  }
  @ActivityCallback private void consent(PluginCall call, ActivityResult r) { if (r.getResultCode() == Activity.RESULT_OK) launch(call); else call.reject("Android no concedió el permiso de VPN"); }
  private void launch(PluginCall call) {
    try {
      String[] subnets = call.getArray("subnets").<String>toList().toArray(new String[0]);
      Intent i = new Intent(getContext(), MiaiVpnService.class).putExtra("host", call.getString("host")).putExtra("port", call.getInt("port", 0))
        .putExtra("key", call.getString("key")).putExtra("subnets", subnets).putExtra("ttlMs", Math.max(10000L, Math.min(call.getLong("ttlMs", 600000L), 7200000L)));
      getContext().startForegroundService(i); call.resolve();
    } catch (Exception e) { call.reject("No se pudo iniciar la VPN"); }
  }
  @PluginMethod public void stop(PluginCall call) { MiaiVpnService.stopNow("cerrada"); call.resolve(); }
  @PluginMethod public void status(PluginCall call) { JSObject r = new JSObject(); r.put("state", MiaiVpnService.state); r.put("expiresAt", MiaiVpnService.expiresAt); call.resolve(r); }
}
