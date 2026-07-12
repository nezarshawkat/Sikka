import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "sikka.app",
  appName: "Sikka",
  webDir: "dist/public",
  bundledWebRuntime: false,
  server: {
    androidScheme: "https",
  },
};

export default config;
