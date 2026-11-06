import { useState } from "react";
import { KeyboardAvoidingView, Platform, TextInput, View } from "react-native";
import Constants from "expo-constants";
import { router } from "expo-router";
import { api, ROLE, setSession } from "../src/api";
import { font, useTheme } from "../src/theme";
import { Button, s, Text } from "../src/ui";

/** OTP login against the website's /api/auth (same signed session). */
export default function Login() {
  const t = useTheme();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const digits = phone.replace(/\D/g, "").slice(-10);
  const input = [{ borderColor: t.border, color: t.ink, backgroundColor: t.card, ...font(600) }, { borderWidth: 1.5, borderRadius: 12, padding: 14, fontSize: 18, marginTop: 8 }];

  async function send() {
    setBusy(true); setErr("");
    try { await api("/api/auth/send-otp", { phone: "+91" + digits, ...(ROLE === "seller" ? { role: "seller" } : {}) }); setSent(true); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function verify() {
    setBusy(true); setErr("");
    try {
      const r = await api<{ buyer_id?: string; seller_id?: string; name?: string; session: string }>("/api/auth/verify-otp", { phone: "+91" + digits, code: code.trim(), ...(ROLE === "seller" ? { role: "seller" } : {}) });
      if (ROLE === "seller") {
        if (!r.seller_id) throw new Error("No Relifish shop on this number. Apply at relifish.com/sell.");
        await setSession({ seller_id: r.seller_id, name: r.name, phone: digits, token: r.session });
        if (Constants.executionEnvironment !== "storeClient") import("../src/push").then((p) => p.registerPush());
        router.replace("/partner/orders");
      } else {
        await setSession({ buyer_id: r.buyer_id, phone: digits, token: r.session });
        if (Constants.executionEnvironment !== "storeClient") import("../src/push").then((p) => p.registerPush());
        router.back();
      }
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: t.page, padding: 20 }}>
      <Text style={[s.h1, { color: t.ink }]}>{sent ? "Enter the code" : "Your mobile number"}</Text>
      <Text style={[s.body, { color: t.ink3, marginTop: 6 }]}>
        {sent ? `We sent a 6-digit code to +91 ${digits}.` : ROLE === "seller" ? "Your shop's registered number. We'll send you a one-time code." : "We'll send you a one-time code. No password needed."}
      </Text>
      {!sent ? (
        <TextInput value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="98765 43210" placeholderTextColor={t.ink3} maxLength={14} style={input} autoFocus />
      ) : (
        <TextInput value={code} onChangeText={setCode} keyboardType="number-pad" placeholder="6-digit code" placeholderTextColor={t.ink3} maxLength={6} style={input} autoFocus textContentType="oneTimeCode" autoComplete="sms-otp" />
      )}
      {!!err && <Text style={{ color: t.red, marginTop: 10, fontWeight: "600" }}>{err}</Text>}
      <View style={{ marginTop: 18 }}>
        {!sent
          ? <Button title="Send code" onPress={send} loading={busy} disabled={!/^[6-9]\d{9}$/.test(digits)} />
          : <Button title="Log in" onPress={verify} loading={busy} disabled={code.trim().length !== 6} />}
        {sent && <Button title="Change number" kind="ghost" onPress={() => { setSent(false); setCode(""); }} style={{ marginTop: 8 }} />}
      </View>
    </KeyboardAvoidingView>
  );
}
