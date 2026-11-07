/**
 * SMS User Consent (Android): start() while the OTP step is open; onCode gets the 6-digit code once the buyer taps Allow
 * on Android's prompt; stops itself after 5 min (onTimeout). No-ops on iOS (oneTimeCode autofill) and where the native
 * module isn't built in (Expo Go, web).
 */
import { Platform } from "react-native";

type Sub = { remove(): void };
let native: any = null;
try { if (Platform.OS === "android") native = require("expo-modules-core").requireOptionalNativeModule("SmsConsent"); } catch {}

export const smsConsentAvailable = !!native;
export function listenForOtp(onCode: (code: string) => void, onTimeout?: () => void): () => void {
  if (!native) return () => {};
  const subs: Sub[] = [native.addListener("onCode", (e: { code: string }) => onCode(e.code)), native.addListener("onTimeout", () => onTimeout?.())];
  native.start();
  return () => { subs.forEach((s) => s.remove()); try { native.stop(); } catch {} };
}
