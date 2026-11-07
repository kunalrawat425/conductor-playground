/**
 * Login as a bottom panel over the page (like the site's LoginSheet): number, then the 6-digit code. The code fills itself
 * from the SMS (Android SMS autofill / iOS one-time-code) and logs in as soon as all 6 digits are in.
 * Same /api/auth endpoints and signed session as the site.
 */
import { track } from "../src/track";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Pressable, View } from "react-native";
import Constants from "expo-constants";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, ROLE, setSession } from "../src/api";
import { useTheme } from "../src/theme";
import { Button, OTPInput, PhoneInput, SheetHeader } from "../src/ui/atoms";
import { Text } from "../src/ui/base";

export default function Login() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const digits = phone.replace(/\D/g, "").slice(-10);
  const seller = ROLE === "seller";
  const close = () => (seller ? null : router.canGoBack() ? router.back() : router.replace("/"));

  useEffect(() => { track("login_shown"); }, []);
  async function send() {
    setBusy(true); setErr("");
    try { await api("/api/auth/send-otp", { phone: "+91" + digits, ...(seller ? { role: "seller" } : {}) }); track(sent ? "otp_resend" : "otp_sent"); setSent(true); setCode(""); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function verify(c = code) {
    if (busy) return;
    setBusy(true); setErr("");
    try {
      const r = await api<{ buyer_id?: string; seller_id?: string; name?: string; session: string }>("/api/auth/verify-otp", { phone: "+91" + digits, code: c.trim(), ...(seller ? { role: "seller" } : {}) });
      if (seller) {
        if (!r.seller_id) throw new Error("No Relifish shop on this number. Apply at relifish.com/sell.");
        await setSession({ seller_id: r.seller_id, name: r.name, phone: digits, token: r.session });
      } else await setSession({ buyer_id: r.buyer_id, phone: digits, token: r.session });
      track("otp_verified");
      if (Constants.executionEnvironment !== "storeClient") import("../src/push").then((p) => p.registerPush());
      if (seller) router.replace("/partner/orders"); else close();
    } catch (e: any) { setErr(e.message); setCode(""); track("otp_failed"); } finally { setBusy(false); }
  }

  return (
    <View style={{ flex: 1, justifyContent: "flex-end" }}>
      <Pressable style={{ position: "absolute", inset: 0, backgroundColor: seller ? t.bg2 : "rgba(15, 23, 42, 0.5)" } as any} onPress={() => close()} />
      {/* Android is edge-to-edge (SDK 58): the window no longer resizes for the keyboard, so pad on both platforms or the panel hides under it. */}
      <KeyboardAvoidingView behavior="padding">
        <View style={{ backgroundColor: t.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: insets.bottom + 16 }}>
          <SheetHeader title={sent ? "Enter the code" : seller ? "Log in to Relifish Partner" : "Log in to Relifish"} />
          <View style={{ padding: 16, gap: 14 }}>
            <Text style={{ fontSize: 13, lineHeight: 19, color: t.ink3 }}>
              {sent ? `We sent a 6-digit code to +91 ${digits}. It fills in by itself when the SMS arrives.` : seller ? "Your shop's registered number. We'll send you a one-time code." : "We'll send you a one-time code. No password needed."}
            </Text>
            {!sent
              ? <PhoneInput value={phone} onChangeText={(v) => setPhone(v.replace(/\D/g, "").slice(-10))} autoFocus error={err || undefined} onSubmitEditing={() => /^[6-9]\d{9}$/.test(digits) && send()} />
              : <OTPInput value={code} onChange={setCode} onComplete={(c) => verify(c)} error={err || undefined} helper="Expires in 10 minutes" />}
            {!sent
              ? <Button title="Send code" full loading={busy} disabled={!/^[6-9]\d{9}$/.test(digits)} onPress={send} />
              : <Button title="Log in" full loading={busy} disabled={code.length !== 6} onPress={() => verify()} />}
            {sent ? (
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Pressable onPress={() => { setSent(false); setCode(""); setErr(""); }} hitSlop={8}><Text style={{ fontSize: 13, fontWeight: "700", color: t.link }}>Change number</Text></Pressable>
                <Pressable onPress={send} hitSlop={8}><Text style={{ fontSize: 13, fontWeight: "700", color: t.link }}>Resend code</Text></Pressable>
              </View>
            ) : null}
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
