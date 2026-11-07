/**
 * Login = the site's LoginSheet redesign (preview "Login redesign"): fish collage behind, white bottom panel with the logo
 * badge, "Log in or sign up", +91 field, Continue, WhatsApp opt-in, terms; then OTP verification (6 boxes filled from the
 * SMS by Android autofill / iOS one-time-code, auto-submit), "Resend SMS in 0:30", "Need help? Call us".
 * Same /api/auth endpoints and signed session as the site. The panel rises with the keyboard (Android is edge-to-edge).
 */
import { useEffect, useState } from "react";
import { Image, KeyboardAvoidingView, Linking, Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import Constants from "expo-constants";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, ROLE, setSession } from "../src/api";
import { track } from "../src/track";
import { listenForOtp, smsConsentAvailable } from "../modules/sms-consent";
import { useFestive, useIsDark, useTheme } from "../src/theme";
import { Button, OTPInput } from "../src/ui/atoms";
import { grad, row, shadowCss, Text } from "../src/ui/base";
import { Icon } from "../src/ui/icons";

const RESEND = 30;
const fmt = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;

export default function Login() {
  const t = useTheme();
  const dark = useIsDark();
  const festive = useFestive();
  const insets = useSafeAreaInsets();
  const seller = ROLE === "seller";
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [wait, setWait] = useState(0);
  const [wa, setWa] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [focus, setFocus] = useState(false);
  const [listening, setListening] = useState(false);
  const ok = /^[6-9]\d{9}$/.test(phone);
  const close = () => (seller ? null : router.canGoBack() ? router.back() : router.replace("/"));

  useEffect(() => { track("login_shown"); }, []);
  // Android SMS User Consent while the OTP step is open: the code fills the boxes and logs in; stops on leave or after 5 min.
  useEffect(() => {
    if (!sent) return;
    let on = true;
    const stop = listenForOtp((c) => { if (!on) return; setListening(false); setCode(c); verify(c); }, () => setListening(false));
    setListening(smsConsentAvailable);
    const cap = setTimeout(() => { stop(); setListening(false); }, 5 * 60_000);
    return () => { on = false; clearTimeout(cap); stop(); setListening(false); };
  }, [sent]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (wait <= 0) return; const id = setTimeout(() => setWait(wait - 1), 1000); return () => clearTimeout(id); }, [wait]);

  async function send() {
    setBusy(true); setErr("");
    try { await api("/api/auth/send-otp", { phone: "+91" + phone, ...(seller ? { role: "seller" } : {}) }); track(sent ? "otp_resend" : "otp_sent"); setSent(true); setCode(""); setWait(RESEND); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function verify(c = code) {
    if (busy) return;
    setBusy(true); setErr("");
    try {
      const r = await api<{ buyer_id?: string; seller_id?: string; name?: string; session: string }>("/api/auth/verify-otp", { phone: "+91" + phone, code: c.trim(), ...(seller ? { role: "seller" } : { whatsapp_opt_in: wa }) });
      if (seller) {
        if (!r.seller_id) throw new Error("No Relifish shop on this number. Apply at relifish.com/sell.");
        await setSession({ seller_id: r.seller_id, name: r.name, phone, token: r.session });
      } else await setSession({ buyer_id: r.buyer_id, phone, token: r.session });
      track("otp_verified");
      if (Constants.executionEnvironment !== "storeClient") import("../src/push").then((p) => p.registerPush());
      if (seller) router.replace("/partner/orders"); else close();
    } catch (e: any) { setErr(e.message); setCode(""); track("otp_failed"); } finally { setBusy(false); }
  }

  // Partner app: the dashboard's green over a dock photo, so it can't be mistaken for the buyer app (founder 7 Nov).
  const shade = seller
    ? dark ? "linear-gradient(180deg, rgba(6,78,59,.55) 0%, rgba(2,44,34,.85) 70%)" : "linear-gradient(180deg, rgba(5,150,105,.35) 0%, rgba(4,120,87,.75) 70%)"
    : dark ? "linear-gradient(180deg, rgba(15,23,42,.35) 20%, rgba(15,23,42,.7) 70%)" : "linear-gradient(180deg, rgba(15,23,42,0) 30%, rgba(15,23,42,.35) 70%)";
  const accent = seller ? t.green : t.brand;
  const gold = festive && !seller;
  const link = { color: t.ink2, textDecorationLine: "underline" as const };
  return (
    <View style={{ flex: 1, backgroundColor: seller ? (dark ? "#064E3B" : "#059669") : dark ? "#0F172A" : t.bg3 }}>
      <Image source={seller ? require("../assets/seller-login.jpg") : require("../assets/login-collage.jpg")} style={[StyleSheet.absoluteFill, { width: "100%", height: seller ? "75%" : "100%", opacity: dark && !seller ? 0.85 : 1 }]} resizeMode="cover" />
      <Pressable style={[StyleSheet.absoluteFill, grad(shade)]} onPress={() => close()} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: "flex-end" }}>
        <View style={[{ backgroundColor: t.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: sent ? 40 : 46, paddingHorizontal: 22, paddingBottom: insets.bottom + 18, alignItems: "stretch" }, shadowCss("0px -10px 30px 0px rgba(0, 0, 0, 0.18)")]}>
          <View style={[{ position: "absolute", top: -30, alignSelf: "center", width: 200, height: seller ? 66 : 60, borderRadius: 18, alignItems: "center", justifyContent: "center", gap: 2, backgroundColor: accent },
            gold ? { borderWidth: 2, borderColor: "#D4A24C" } : null, gold ? grad("linear-gradient(135deg, #B3123B, #8B0A2E)") : seller ? grad("linear-gradient(135deg, #059669, #10B981)") : null,
            shadowCss(gold ? "0px 10px 24px 0px rgba(139, 10, 46, 0.35)" : seller ? "0px 10px 24px 0px rgba(5, 150, 105, 0.35)" : "0px 10px 24px 0px rgba(0, 102, 255, 0.3)")]}>
            <Image source={gold ? require("../assets/logo-gold.png") : require("../assets/logo-white.png")} style={{ width: seller ? 132 : 152, height: seller ? 31 : 36 }} resizeMode="contain" />
            {seller ? <Text style={{ fontSize: 9, fontWeight: "800", letterSpacing: 1.44, color: "#FFFFFF", opacity: 0.92 }}>PARTNER · FOR SELLERS</Text> : null}
          </View>

          {!sent ? (
            <>
              <Text style={{ textAlign: "center", fontSize: 20, lineHeight: 25, letterSpacing: -0.4, fontWeight: "800", marginTop: 2, marginBottom: 4 }}>{seller ? "Seller sign in" : "Fresh fish from verified sellers,\ncleaned & cut"}</Text>
              <Text style={{ textAlign: "center", fontSize: 13, fontWeight: "500", color: t.ink3 }}>{seller ? "Manage orders, menu and deliveries" : festive ? "Happy Diwali · Thane & Mumbai, delivered" : "Thane & Mumbai · delivered to your door"}</Text>
              <View style={[row, { gap: 12, marginTop: 16, marginBottom: 12 }]}>
                <View style={{ flex: 1, height: 1, backgroundColor: t.border }} />
                <Text style={{ fontSize: 13, fontWeight: "600", color: t.ink3 }}>{seller ? "Your shop's registered number" : "Log in or sign up"}</Text>
                <View style={{ flex: 1, height: 1, backgroundColor: t.border }} />
              </View>
              <View style={[row, { height: 54, borderWidth: 1.5, borderRadius: 12, borderColor: err ? t.red : focus ? accent : t.border, backgroundColor: t.bg, overflow: "hidden" }, focus ? shadowCss(`0px 0px 0px 3px ${seller ? t.greenL : t.brandL}`) : null]}>
                <View style={{ height: "100%", justifyContent: "center", paddingLeft: 14, paddingRight: 12, borderRightWidth: 1.5, borderRightColor: t.border }}><Text style={{ fontSize: 16, fontWeight: "700" }}>+91</Text></View>
                <TextInput value={phone} onChangeText={(v) => setPhone(v.replace(/\D/g, "").slice(-10))} autoFocus keyboardType="phone-pad" maxLength={14}
                  placeholder="Enter mobile number" placeholderTextColor={t.ink4} textContentType="telephoneNumber" autoComplete="tel" onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
                  onSubmitEditing={() => ok && send()} style={{ flex: 1, height: "100%", paddingHorizontal: 14, fontSize: 17, letterSpacing: 0.68, color: t.ink, fontFamily: phone ? "Inter_600SemiBold" : "Inter_500Medium" }} />
              </View>
              {err ? <Text style={{ marginTop: 6, fontSize: 12, color: t.red }}>{err}</Text> : null}
              <Button title="Continue" full size="lg" loading={busy} disabled={!ok} onPress={send} textColor={ok ? undefined : t.ink4} color={seller ? t.green : undefined}
                style={{ marginTop: 12, height: 54, borderRadius: 12, opacity: 1, ...(!ok ? { backgroundColor: t.bg3 } : {}) }} />
              {!seller ? (
                <Pressable onPress={() => setWa(!wa)} style={[row, { alignItems: "flex-start", gap: 10, marginTop: 12 }]} accessibilityRole="checkbox" accessibilityState={{ checked: wa }}>
                  <View style={{ width: 18, height: 18, marginTop: 1, borderRadius: 5, borderWidth: 1.5, borderColor: wa ? t.brand : t.ink4, backgroundColor: wa ? t.brand : t.bg, alignItems: "center", justifyContent: "center" }}>{wa ? <Icon name="check" size={12} color="#FFFFFF" strokeWidth={3} /> : null}</View>
                  <Text style={{ flex: 1, fontSize: 12, lineHeight: 17.4, fontWeight: "500", color: t.ink2 }}>Send me order updates and fresh-catch alerts on WhatsApp. Reply STOP anytime.</Text>
                </Pressable>
              ) : null}
              <Text style={{ marginTop: 12, textAlign: "center", fontSize: 11, lineHeight: 16.5, fontWeight: "500", color: t.ink3 }}>
                By continuing, you agree to our <Text style={link} onPress={() => Linking.openURL(`https://www.relifish.com/terms${seller ? "#sellers" : ""}`)}>Terms of service</Text> & <Text style={link} onPress={() => Linking.openURL("https://www.relifish.com/privacy")}>Privacy policy</Text>
              </Text>
              {seller ? <Pressable onPress={() => Linking.openURL("https://play.google.com/store/apps/details?id=com.relifish.app")} style={{ marginTop: 10, alignItems: "center" }}><Text style={{ fontSize: 13, fontWeight: "700", color: t.green }}>Buying fish? Get the Relifish app</Text></Pressable> : null}
            </>
          ) : (
            <>
              <View style={{ alignItems: "center", justifyContent: "center", marginBottom: 6 }}>
                <Pressable accessibilityLabel="Change number" onPress={() => { setSent(false); setCode(""); setErr(""); }} style={{ position: "absolute", left: 0, top: -4, width: 34, height: 34, borderRadius: 17, backgroundColor: t.bg3, alignItems: "center", justifyContent: "center" }}><Icon name="back" size={18} color={t.ink} /></Pressable>
                <Text style={{ fontSize: 19, fontWeight: "800" }}>OTP verification</Text>
              </View>
              <Text style={{ textAlign: "center", fontSize: 14, lineHeight: 21, fontWeight: "500", color: t.ink3 }}>
                Sent by SMS to <Text style={{ fontWeight: "800", color: t.ink }}>+91 {phone.slice(0, 5)} {phone.slice(5)}</Text> · <Text style={{ fontWeight: "700", color: t.link }} onPress={() => { setSent(false); setCode(""); setErr(""); }}>Change</Text>
              </Text>
              <View style={{ marginTop: 20, marginBottom: 14 }}><OTPInput value={code} onChange={setCode} onComplete={(c) => verify(c)} error={err || undefined} cell={46} gap={9} /></View>
              {listening && code.length < 6 && !err ? (
                <View style={[row, { alignSelf: "center", gap: 6 }]}><View style={[{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.green }, shadowCss(`0px 0px 0px 3px ${t.greenL}`)]} /><Text style={{ fontSize: 12, fontWeight: "600", color: t.green }}>Reading the code from SMS…</Text></View>
              ) : null}
              <Button title="Verify & continue" full color={seller ? t.green : undefined} loading={busy} disabled={code.length !== 6} onPress={() => verify()} style={{ marginTop: 14, height: 54, borderRadius: 12 }} />
              <Pressable disabled={wait > 0 || busy} onPress={send} style={{ marginTop: 12, alignItems: "center" }}>
                {wait > 0
                  ? <Text style={{ fontSize: 14, fontWeight: "500", color: t.ink3 }}>Didn't get it? Resend SMS in <Text style={{ fontWeight: "700", color: t.ink }}>{fmt(wait)}</Text></Text>
                  : <Text style={{ fontSize: 14, fontWeight: "700", color: t.link }}>Resend SMS</Text>}
              </Pressable>
              <Pressable onPress={() => Linking.openURL("tel:+919152207607")} style={{ marginTop: 10, alignItems: "center" }}><Text style={{ fontSize: 13, fontWeight: "600", color: t.ink2, textDecorationLine: "underline" }}>Need help? Call us</Text></Pressable>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
