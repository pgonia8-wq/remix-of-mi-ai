package com.miai.app;

import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MiaiKeystorePlugin.class);
        registerPlugin(MiaiRemotePlugin.class);
        registerPlugin(MiaiSchedulePlugin.class);
        registerPlugin(MiaiMediaPlugin.class);
        registerPlugin(MiaiTunnelPlugin.class);
        registerPlugin(MiaiVpnPlugin.class);
        registerPlugin(MiaiDevicePlugin.class);
        super.onCreate(savedInstanceState);
        edgeToEdge();
        // Files or text shared from other apps ("Compartir en… MI AI"); not re-read after a configuration change.
        if (savedInstanceState == null) MiaiDevicePlugin.received(this, getIntent());
    }

    /**
     * Same layout on every phone (Android 11–15, notches, punch holes, gesture or button navigation):
     * the app draws behind transparent system bars and receives the real status bar, cutout,
     * navigation bar and keyboard sizes, which the web layer applies as padding.
     */
    private void edgeToEdge() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.setAppearanceLightStatusBars(false); // light icons over the dark app background
        c.setAppearanceLightNavigationBars(false);
        if (getBridge() == null) return;
        final WebView wv = getBridge().getWebView();
        final float d = getResources().getDisplayMetrics().density;
        ViewCompat.setOnApplyWindowInsetsListener(wv, (v, insets) -> {
            Insets b = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            MiaiDevicePlugin.insetsChanged(b.top / d, b.right / d, b.bottom / d, b.left / d, ime.bottom / d);
            return WindowInsetsCompat.CONSUMED;
        });
        ViewCompat.requestApplyInsets(wv);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        MiaiDevicePlugin.received(this, intent);
    }
}
