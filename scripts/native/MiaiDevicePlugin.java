package com.miai.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.*;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.*;
import java.util.*;

/**
 * Device integration without a shell: background-work notice, "Guardar como" (Storage Access Framework),
 * "Compartir en…" (Android share sheet) and receiving files/text shared from other apps.
 * Only files inside the app cache can be saved or shared; received items are copied into a private inbox.
 */
@CapacitorPlugin(name = "MiaiDevice")
public class MiaiDevicePlugin extends Plugin {
  static volatile MiaiDevicePlugin instance;
  static final List<JSObject> inbox = Collections.synchronizedList(new ArrayList<>());
  static final long MAX_ITEM = 1024L * 1024 * 1024; // 1 GB per received file
  static final int MAX_ITEMS = 20;

  @Override public void load() { instance = this; }

  // ---------- screen insets (status bar, cutout, navigation bar, keyboard) in CSS px ----------
  static volatile float[] insets = new float[] { 0, 0, 0, 0, 0 };
  static JSObject insetsObj() {
    float[] i = insets; JSObject o = new JSObject();
    o.put("top", i[0]); o.put("right", i[1]); o.put("bottom", i[2]); o.put("left", i[3]); o.put("ime", i[4]);
    return o;
  }
  static void insetsChanged(float top, float right, float bottom, float left, float ime) {
    insets = new float[] { top, right, bottom, left, ime };
    MiaiDevicePlugin p = instance; if (p != null) p.notifyListeners("insets", insetsObj(), true);
  }
  @PluginMethod public void getInsets(PluginCall call) { call.resolve(insetsObj()); }

  // ---------- background work notice ----------
  @PluginMethod public void startWork(PluginCall call) {
    try {
      Intent i = new Intent(getContext(), MiaiWorkService.class).putExtra("title", call.getString("title", "Agentes de MI AI trabajando")).putExtra("text", call.getString("text", "Toca para ver el avance"));
      if (Build.VERSION.SDK_INT >= 26) getContext().startForegroundService(i); else getContext().startService(i);
      call.resolve();
    } catch (Exception e) { call.reject("Android no permitió mantener a los agentes trabajando en segundo plano"); }
  }
  @PluginMethod public void stopWork(PluginCall call) { getContext().stopService(new Intent(getContext(), MiaiWorkService.class)); call.resolve(); }

  // ---------- cache-only file access ----------
  private File cacheFile(String rel) throws IOException {
    File root = getContext().getCacheDir().getCanonicalFile();
    File f = new File(root, rel == null ? "" : rel).getCanonicalFile();
    if (!f.getPath().startsWith(root.getPath() + File.separator) || !f.isFile()) throw new IOException("ruta no permitida");
    return f;
  }

  @PluginMethod public void saveAs(PluginCall call) {
    try { cacheFile(call.getString("path")); } catch (IOException e) { call.reject("Archivo temporal no encontrado"); return; }
    Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
      .setType(call.getString("mime", "application/octet-stream")).putExtra(Intent.EXTRA_TITLE, call.getString("name", "archivo"));
    startActivityForResult(call, i, "saveAsResult");
  }
  @ActivityCallback private void saveAsResult(PluginCall call, ActivityResult r) {
    if (call == null) return;
    Uri uri = r.getData() == null ? null : r.getData().getData();
    if (r.getResultCode() != Activity.RESULT_OK || uri == null) { JSObject o = new JSObject(); o.put("saved", false); call.resolve(o); return; }
    new Thread(() -> {
      try {
        File src = cacheFile(call.getString("path"));
        try (InputStream in = new FileInputStream(src); OutputStream out = getContext().getContentResolver().openOutputStream(uri, "w")) {
          if (out == null) throw new IOException("destino");
          byte[] buf = new byte[256 * 1024]; int n; while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        }
        src.delete();
        JSObject o = new JSObject(); o.put("saved", true); call.resolve(o);
      } catch (Exception e) { call.reject("No se pudo guardar en el lugar elegido"); }
    }).start();
  }

  @PluginMethod public void share(PluginCall call) {
    try {
      Intent s = new Intent(Intent.ACTION_SEND);
      String path = call.getString("path"); String text = call.getString("text"); String subject = call.getString("subject");
      if (path != null && !path.isEmpty()) {
        File f = cacheFile(path);
        Uri u = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
        s.setType(call.getString("mime", "application/octet-stream"));
        s.putExtra(Intent.EXTRA_STREAM, u); s.setClipData(ClipData.newRawUri(f.getName(), u));
        s.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
      } else s.setType("text/plain");
      if (text != null && !text.isEmpty()) s.putExtra(Intent.EXTRA_TEXT, text);
      if (subject != null && !subject.isEmpty()) s.putExtra(Intent.EXTRA_SUBJECT, subject);
      // "Enviar por Bluetooth": open the system Bluetooth sender directly when present (package name varies by maker).
      if ("bluetooth".equals(call.getString("target"))) {
        for (android.content.pm.ResolveInfo ri : getContext().getPackageManager().queryIntentActivities(s, 0)) {
          if (ri.activityInfo != null && ri.activityInfo.packageName.toLowerCase(Locale.ROOT).contains("bluetooth")) {
            s.setClassName(ri.activityInfo.packageName, ri.activityInfo.name);
            getActivity().startActivity(s);
            JSObject o = new JSObject(); o.put("direct", true); call.resolve(o); return;
          }
        }
      }
      Intent chooser = Intent.createChooser(s, call.getString("title", "Compartir en…"));
      chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
      getActivity().startActivity(chooser);
      JSObject o = new JSObject(); o.put("direct", false); call.resolve(o);
    } catch (Exception e) { call.reject("No se pudo abrir Compartir en…"); }
  }

  // ---------- receiving shares ----------
  @PluginMethod public void getInbox(PluginCall call) {
    JSArray a = new JSArray(); synchronized (inbox) { for (JSObject o : inbox) a.put(o); }
    JSObject r = new JSObject(); r.put("items", a); call.resolve(r);
  }
  @PluginMethod public void clearInbox(PluginCall call) {
    synchronized (inbox) { inbox.clear(); }
    File dir = new File(getContext().getCacheDir(), "miai-inbox"); File[] fs = dir.listFiles(); if (fs != null) for (File f : fs) f.delete();
    call.resolve();
  }

  /** Called by MainActivity for ACTION_SEND / ACTION_SEND_MULTIPLE. Copies off the UI thread, then notifies the app. */
  static void received(Context ctx, Intent intent) {
    if (intent == null) return;
    String action = intent.getAction();
    if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) return;
    final String text = intent.getStringExtra(Intent.EXTRA_TEXT);
    final String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
    final String type = intent.getType();
    final List<Uri> uris = new ArrayList<>();
    try {
      if (Intent.ACTION_SEND.equals(action)) { Uri u = intent.getParcelableExtra(Intent.EXTRA_STREAM); if (u != null) uris.add(u); }
      else { ArrayList<Uri> l = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM); if (l != null) uris.addAll(l); }
    } catch (Exception ignored) {}
    final Context app = ctx.getApplicationContext();
    new Thread(() -> {
      File dir = new File(app.getCacheDir(), "miai-inbox"); dir.mkdirs();
      int count = 0;
      for (Uri u : uris) {
        if (count >= MAX_ITEMS) break;
        // Only content:// from other apps: never file:// (could point at our own private data) nor our own provider.
        if (!"content".equals(u.getScheme()) || (app.getPackageName() + ".fileprovider").equals(u.getAuthority())) continue;
        String name = "archivo"; long size = -1;
        try (Cursor c = app.getContentResolver().query(u, null, null, null, null)) {
          if (c != null && c.moveToFirst()) { int ni = c.getColumnIndex(OpenableColumns.DISPLAY_NAME); int si = c.getColumnIndex(OpenableColumns.SIZE); if (ni >= 0 && c.getString(ni) != null) name = c.getString(ni); if (si >= 0 && !c.isNull(si)) size = c.getLong(si); }
        } catch (Exception ignored) {}
        if (size > MAX_ITEM) continue;
        String safe = name.replaceAll("[^\\w.\\- ]", "_"); if (safe.length() > 120) safe = safe.substring(safe.length() - 120);
        File out = new File(dir, UUID.randomUUID() + "-" + safe);
        long written = 0; boolean ok = true;
        try (InputStream in = app.getContentResolver().openInputStream(u); OutputStream o = new FileOutputStream(out)) {
          if (in == null) throw new IOException();
          byte[] buf = new byte[256 * 1024]; int n;
          while ((n = in.read(buf)) > 0) { written += n; if (written > MAX_ITEM) throw new IOException("grande"); o.write(buf, 0, n); }
        } catch (Exception e) { ok = false; out.delete(); }
        if (!ok) continue;
        String mime = app.getContentResolver().getType(u); if (mime == null) mime = type == null ? "application/octet-stream" : type;
        JSObject item = new JSObject(); item.put("kind", "file"); item.put("path", "miai-inbox/" + out.getName()); item.put("name", name); item.put("mime", mime); item.put("size", written);
        inbox.add(item); count++;
      }
      if (text != null && !text.trim().isEmpty()) {
        JSObject item = new JSObject(); item.put("kind", "text"); item.put("text", text.length() > 200000 ? text.substring(0, 200000) : text); if (subject != null) item.put("name", subject);
        inbox.add(item);
      }
      MiaiDevicePlugin p = instance; if (p != null) p.notifyListeners("inbox", new JSObject(), true);
    }).start();
  }
}
