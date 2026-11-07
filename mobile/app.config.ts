import type { ExpoConfig } from "expo/config";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { existsSync } = require("fs") as { existsSync: (p: string) => boolean };
import V from "./version.json";

// Two store apps from one codebase (founder, 6 Nov 2026): Relifish (buyers) now, Relifish Partner (sellers) next.
const partner = process.env.APP_VARIANT === "partner";
const istDay = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
const diwali = process.env.EXPO_PUBLIC_FESTIVE_OVERRIDE === "diwali" || (process.env.EXPO_PUBLIC_FESTIVE_OVERRIDE !== "off" && istDay >= "2026-10-28" && istDay <= "2026-11-15");
const iosPlist = partner ? "./firebase/GoogleService-Info-partner.plist" : "./firebase/GoogleService-Info-buyer.plist";

const config: ExpoConfig = {
  name: partner ? "Relifish Partner" : "Relifish",
  slug: partner ? "relifish-partner" : "relifish",
  scheme: partner ? "relifishpartner" : "relifish",
  version: V.version, // one source: version.json (node scripts/bump-version.mjs)
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: partner ? "com.relifish.partner" : "com.relifish.app",
    buildNumber: V.iosBuildNumber,
    supportsTablet: false,
    // Firebase iOS config per app (git-ignored like the Android files); add the plists when the Apple account exists.
    ...(existsSync(iosPlist) ? { googleServicesFile: iosPlist } : {}),
    infoPlist: { UIBackgroundModes: ["remote-notification"], NSLocationWhenInUseUsageDescription: "Relifish uses your location to show fish sellers who deliver to you." },
    // Push entitlement (aps-environment) is added by expo-notifications at prebuild; critical alerts need Apple approval.
  },
  android: {
    package: partner ? "com.relifish.partner" : "com.relifish.app",
    versionCode: V.androidVersionCode,
    adaptiveIcon: { foregroundImage: "./assets/adaptive-icon.png", backgroundColor: "#0066FF" },
    permissions: ["ACCESS_COARSE_LOCATION", "ACCESS_FINE_LOCATION", "POST_NOTIFICATIONS", "USE_FULL_SCREEN_INTENT", "VIBRATE", "WAKE_LOCK"],
    // Firebase project "relifish" (relifishstore@gmail.com); files are git-ignored, kept in mobile/firebase/.
    googleServicesFile: partner ? "./firebase/google-services-partner.json" : "./firebase/google-services-buyer.json",
  },
  plugins: [
    "expo-router",
    "./plugins/with-notifee",
    "expo-secure-store",
    // Native splash = the site's #rf-splash wordmark: gold logo on maroon in the Diwali window (28 Oct–15 Nov IST, the
    // same window as src/lib/festive-window.ts), white logo on brand blue otherwise. Fixed at build time; the JS splash
    // (src/Splash.tsx) follows the live theme right after.
    ["expo-splash-screen", diwali
      ? { image: "./assets/logo-gold.png", imageWidth: 230, backgroundColor: "#6E0822" }
      : { image: "./assets/logo-white.png", imageWidth: 230, backgroundColor: "#0066FF" }],
    ["expo-notifications", { color: "#0066FF", sounds: ["./assets/sounds/new_order.wav"] }],
    ["expo-location", { locationWhenInUsePermission: "Relifish uses your location to show fish sellers who deliver to you." }],
  ],
  experiments: { typedRoutes: false },
  // Staging QA builds set EXPO_PUBLIC_API_BASE / EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON (src/api.ts).
  extra: { apiBase: "https://www.relifish.com", variant: partner ? "partner" : "buyer" },
};

export default config;
