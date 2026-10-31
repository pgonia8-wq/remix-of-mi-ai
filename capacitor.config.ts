import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.miai.app",
  appName: "MI AI",
  webDir: "dist/client",
  android: { allowMixedContent: false },
  plugins: {
    CapacitorSQLite: {
      androidIsEncryption: true,
      androidBiometric: { biometricAuth: false },
    },
  },
};

export default config;
