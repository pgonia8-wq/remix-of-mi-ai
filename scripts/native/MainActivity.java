package com.miai.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MiaiKeystorePlugin.class);
        registerPlugin(MiaiRemotePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
