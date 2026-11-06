import type { ExpoConfig } from "expo/config";

// Two store apps from one codebase (founder, 6 Nov 2026): Relifish (buyers) now, Relifish Partner (sellers) next.
const partner = process.env.APP_VARIANT === "partner";

const config: ExpoConfig = {
  name: partner ? "Relifish Partner" : "Relifish",
  slug: partner ? "relifish-partner" : "relifish",
  scheme: partner ? "relifishpartner" : "relifish",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  ios: { bundleIdentifier: partner ? "com.relifish.partner" : "com.relifish.app", supportsTablet: false },
  android: {
    package: partner ? "com.relifish.partner" : "com.relifish.app",
    adaptiveIcon: { foregroundImage: "./assets/adaptive-icon.png", backgroundColor: "#0066FF" },
    permissions: ["ACCESS_COARSE_LOCATION", "ACCESS_FINE_LOCATION", "POST_NOTIFICATIONS", "USE_FULL_SCREEN_INTENT", "VIBRATE", "WAKE_LOCK"],
    // Firebase project "relifish" (relifishstore@gmail.com); files are git-ignored, kept in mobile/firebase/.
    googleServicesFile: partner ? "./firebase/google-services-partner.json" : "./firebase/google-services-buyer.json",
  },
  plugins: [
    "expo-router",
    "./plugins/with-notifee",
    "expo-secure-store",
    ["expo-splash-screen", { image: "./assets/splash.png", imageWidth: 220, backgroundColor: "#0066FF" }],
    ["expo-notifications", { color: "#0066FF", sounds: ["./assets/sounds/new_order.wav"] }],
    ["expo-location", { locationWhenInUsePermission: "Relifish uses your location to show fish sellers who deliver to you." }],
  ],
  experiments: { typedRoutes: false },
  // Staging QA builds set EXPO_PUBLIC_API_BASE / EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON (src/api.ts).
  extra: { apiBase: "https://www.relifish.com", variant: partner ? "partner" : "buyer" },
};

export default config;
