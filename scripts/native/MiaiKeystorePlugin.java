package com.miai.app;

import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.os.BatteryManager;
import android.os.Build;
import android.os.PowerManager;
import android.os.StatFs;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyInfo;
import android.security.keystore.KeyProperties;
import android.security.keystore.StrongBoxUnavailableException;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.ByteBuffer;
import java.security.KeyStore;
import java.util.Arrays;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;

/**
 * MI AI master keys live INSIDE Android Keystore: AES-256-GCM, non-exportable, StrongBox when available.
 * JavaScript never sees the master key; it only sends data keys (DEKs) to be wrapped/unwrapped here.
 * Never logs key material, DEKs or AAD.
 */
@CapacitorPlugin(name = "MiaiKeystore")
public class MiaiKeystorePlugin extends Plugin {
    private static final String PREFIX = "miai_master_v";

    private KeyStore ks() throws Exception { KeyStore k = KeyStore.getInstance("AndroidKeyStore"); k.load(null); return k; }

    private boolean hasStrongBox() {
        return Build.VERSION.SDK_INT >= 28 && getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE);
    }

    private void generate(String alias, boolean strongBox) throws Exception {
        KeyGenParameterSpec.Builder b = new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setRandomizedEncryptionRequired(true);
        if (strongBox && Build.VERSION.SDK_INT >= 28) b.setIsStrongBoxBacked(true);
        KeyGenerator g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        g.init(b.build());
        g.generateKey();
    }

    private String level(SecretKey key) {
        try {
            SecretKeyFactory f = SecretKeyFactory.getInstance(key.getAlgorithm(), "AndroidKeyStore");
            KeyInfo info = (KeyInfo) f.getKeySpec(key, KeyInfo.class);
            if (Build.VERSION.SDK_INT >= 31) {
                int s = info.getSecurityLevel();
                if (s == KeyProperties.SECURITY_LEVEL_STRONGBOX) return "strongbox";
                if (s == KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT) return "tee";
                if (s == KeyProperties.SECURITY_LEVEL_SOFTWARE) return "software";
                return "secure-hardware";
            }
            return info.isInsideSecureHardware() ? "secure-hardware" : "software";
        } catch (Exception e) { return "software"; }
    }

    @PluginMethod
    public void ensureKey(PluginCall call) {
        try {
            String alias = PREFIX + call.getInt("version", 1);
            KeyStore k = ks();
            boolean sbUsed = false;
            if (!k.containsAlias(alias)) {
                if (hasStrongBox()) {
                    try { generate(alias, true); sbUsed = true; }
                    catch (StrongBoxUnavailableException e) { generate(alias, false); }
                    catch (Exception e) { generate(alias, false); }
                } else generate(alias, false);
            }
            SecretKey key = (SecretKey) k.getKey(alias, null);
            String lvl = level(key);
            JSObject r = new JSObject();
            r.put("securityLevel", lvl);
            r.put("strongBoxAvailable", hasStrongBox());
            r.put("strongBoxUsed", "strongbox".equals(lvl) || (sbUsed && Build.VERSION.SDK_INT < 31));
            call.resolve(r);
        } catch (Exception e) { call.reject("Keystore no disponible"); }
    }

    @PluginMethod
    public void wrap(PluginCall call) {
        try {
            SecretKey key = (SecretKey) ks().getKey(PREFIX + call.getInt("version", 1), null);
            if (key == null) { call.reject("Llave inexistente"); return; }
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, key); // Keystore generates a fresh random IV per operation
            c.updateAAD(Base64.decode(call.getString("aad", ""), Base64.NO_WRAP));
            byte[] ct = c.doFinal(Base64.decode(call.getString("data", ""), Base64.NO_WRAP));
            byte[] iv = c.getIV();
            byte[] out = ByteBuffer.allocate(iv.length + ct.length).put(iv).put(ct).array();
            JSObject r = new JSObject(); r.put("data", Base64.encodeToString(out, Base64.NO_WRAP)); call.resolve(r);
        } catch (Exception e) { call.reject("No se pudo envolver la llave"); }
    }

    @PluginMethod
    public void unwrap(PluginCall call) {
        try {
            SecretKey key = (SecretKey) ks().getKey(PREFIX + call.getInt("version", 1), null);
            if (key == null) { call.reject("Llave inexistente"); return; }
            byte[] in = Base64.decode(call.getString("data", ""), Base64.NO_WRAP);
            if (in.length < 12 + 16) { call.reject("Datos inválidos"); return; }
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, Arrays.copyOfRange(in, 0, 12)));
            c.updateAAD(Base64.decode(call.getString("aad", ""), Base64.NO_WRAP));
            byte[] pt = c.doFinal(Arrays.copyOfRange(in, 12, in.length));
            JSObject r = new JSObject(); r.put("data", Base64.encodeToString(pt, Base64.NO_WRAP));
            Arrays.fill(pt, (byte) 0);
            call.resolve(r);
        } catch (Exception e) { call.reject("No se pudo descifrar la llave"); }
    }

    @PluginMethod
    public void deleteKey(PluginCall call) {
        try { ks().deleteEntry(PREFIX + call.getInt("version", 1)); call.resolve(); }
        catch (Exception e) { call.reject("No se pudo eliminar la llave"); }
    }

    @PluginMethod
    public void deviceInfo(PluginCall call) {
        JSObject r = new JSObject();
        try {
            Context ctx = getContext();
            ActivityManager am = (ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
            ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
            am.getMemoryInfo(mi);
            r.put("availMemMB", mi.availMem / (1024 * 1024));
            r.put("totalMemMB", mi.totalMem / (1024 * 1024));
            r.put("lowMemory", mi.lowMemory);
            r.put("cores", Runtime.getRuntime().availableProcessors());
            JSArray abis = new JSArray(); for (String a : Build.SUPPORTED_ABIS) abis.put(a); r.put("abis", abis);
            StatFs st = new StatFs(ctx.getFilesDir().getAbsolutePath());
            r.put("freeStorageMB", st.getAvailableBytes() / (1024 * 1024));
            Intent bat = ctx.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
            if (bat != null) {
                int lv = bat.getIntExtra(BatteryManager.EXTRA_LEVEL, -1), sc = bat.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
                if (lv >= 0 && sc > 0) r.put("batteryPct", Math.round(lv * 100f / sc));
                int plug = bat.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0); r.put("charging", plug != 0);
            }
            if (Build.VERSION.SDK_INT >= 29) { PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE); r.put("thermal", pm.getCurrentThermalStatus()); }
            r.put("strongBox", hasStrongBox());
            r.put("manufacturer", Build.MANUFACTURER);
            r.put("model", Build.MODEL);
            r.put("sdk", Build.VERSION.SDK_INT);
            call.resolve(r);
        } catch (Exception e) { call.reject("Diagnóstico no disponible"); }
    }
}
