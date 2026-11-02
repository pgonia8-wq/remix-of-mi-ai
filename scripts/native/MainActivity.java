package com.miai.app;

import android.content.Intent;
import android.os.Bundle;
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
        // Files or text shared from other apps ("Compartir en… MI AI"); not re-read after a configuration change.
        if (savedInstanceState == null) MiaiDevicePlugin.received(this, getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        MiaiDevicePlugin.received(this, intent);
    }
}
