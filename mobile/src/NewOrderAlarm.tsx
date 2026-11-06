import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Modal, Vibration, View } from "react-native";
import { router } from "expo-router";
import Constants from "expo-constants";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, getSession } from "./api";
import { CLOSED, planFor, qtyLabel, sellerPost } from "./partner";
import { stopRings } from "./ring";
import { useTheme } from "./theme";
import { Button, Text } from "./ui";

const POLL_MS = 20_000;
const RING_CAP_MS = 60_000;
/** Orders already waiting when the app opens ring only if they came in this recently. */
const FRESH_MS = 10 * 60_000;
const needsSeller = (o: any) => planFor(o, o.cart_items).acts.some((a) => a.action === "accept");

/**
 * Relifish Partner rings like a ride app: while the app is open, a new order the seller has to confirm plays the
 * ringtone on loop with a full-screen "Accept / View" sheet, until the seller taps, the order is handled
 * elsewhere, or 60 s pass. Checks every 20 s, when the app comes back to the front, and when a push lands.
 * (Closed app: the push itself rings, on the "orders" channel with the same sound; see src/push.ts.)
 */
export function NewOrderAlarm() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [order, setOrder] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const seen = useRef<Set<string> | null>(null);
  const player = useRef<AudioPlayer | null>(null);
  const cap = useRef<ReturnType<typeof setTimeout> | null>(null);

  const silence = useCallback(() => {
    player.current?.pause();
    player.current?.remove();
    player.current = null;
    Vibration.cancel();
    stopRings();
    if (cap.current) clearTimeout(cap.current);
  }, []);
  const close = useCallback(() => { silence(); setOrder(null); }, [silence]);

  const ring = useCallback(async (o: any) => {
    setOrder(o);
    if (player.current) return;
    await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: "doNotMix" }).catch(() => {});
    const p = createAudioPlayer(require("../assets/sounds/new_order.wav"));
    p.loop = true;
    p.play();
    player.current = p;
    Vibration.vibrate([0, 800, 600], true);
    cap.current = setTimeout(silence, RING_CAP_MS);
  }, [silence]);

  const check = useCallback(async () => {
    const me = await getSession();
    if (!me?.seller_id) return;
    const r = await api(`/api/seller/orders?seller_id=${me.seller_id}&tab=pending`).catch(() => null);
    if (!r) return;
    const waiting: any[] = (r.orders || []).filter(needsSeller);
    if (!seen.current) seen.current = new Set(waiting.filter((o) => Date.now() - Date.parse(o.created_at) > FRESH_MS).map((o) => o.id));
    // Confirmed or declined somewhere else (the website, another phone): stop.
    setOrder((cur: any) => { if (cur && !waiting.some((o) => o.id === cur.id)) { silence(); return null; } return cur; });
    const fresh = waiting.find((o) => !seen.current!.has(o.id));
    if (fresh) { waiting.forEach((o) => seen.current!.add(o.id)); ring(fresh); }
  }, [ring, silence]);

  useEffect(() => {
    stopRings(); // the app is open: the in-app alarm takes over from a lock-screen ring
    check();
    const timer = setInterval(check, POLL_MS);
    const app = AppState.addEventListener("change", (s) => s === "active" && check());
    // A push for a new order: check at once instead of waiting for the next poll (real builds only).
    let push: { remove(): void } | undefined;
    if (Constants.executionEnvironment !== "storeClient") {
      import("expo-notifications").then((N) => { push = N.addNotificationReceivedListener(() => check()); });
    }
    return () => { clearInterval(timer); app.remove(); push?.remove(); silence(); };
  }, [check, silence]);

  if (!order) return null;
  const rows: any[] = (order.cart_items || [order]).filter((r: any) => !CLOSED.includes(r.status));
  const total = rows.reduce((n, r) => n + (Number(r.total_price || r.final_price) || 0) + (Number(r.delivery_fee) || 0), 0);
  async function accept() {
    setBusy(true);
    silence();
    try {
      await sellerPost("/api/seller/orders", { order_id: order.id, status: "confirmed", ...(order.cart_items ? { cart: true } : {}) });
      setOrder(null);
      router.replace("/partner/orders");
    } catch (e: any) {
      setOrder({ ...order, error: e.message });
    } finally { setBusy(false); }
  }
  return (
    <Modal visible animationType="slide" onRequestClose={close} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: t.green, paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24, paddingHorizontal: 24, justifyContent: "space-between" }}>
        <View>
          <Text style={{ fontSize: 14, fontWeight: "700", color: t.onBrand, opacity: 0.9, letterSpacing: 1, textTransform: "uppercase" }}>🔔 New order</Text>
          <Text style={{ fontSize: 44, fontWeight: "900", color: t.onBrand, marginTop: 8 }}>₹{total.toLocaleString("en-IN")}</Text>
          {rows.map((r) => (
            <Text key={r.id} style={{ fontSize: 18, fontWeight: "700", color: t.onBrand, marginTop: 10, textTransform: "capitalize" }}>{r.listing?.species || r.species} · {qtyLabel(r)}</Text>
          ))}
          <Text style={{ fontSize: 14, color: t.onBrand, opacity: 0.9, marginTop: 14 }}>
            {order.order_type === "delivery" ? "Delivery" : "Pickup"}{order.pay_on_delivery && !order.razorpay_payment_id ? " · pay on delivery" : " · paid online"}
          </Text>
          {order.error ? <Text style={{ fontSize: 14, fontWeight: "700", color: t.onBrand, marginTop: 14 }}>Couldn't accept: {order.error}</Text> : null}
        </View>
        <View style={{ gap: 12 }}>
          <Button title="✓ Accept order" size="lg" onPress={accept} loading={busy} textColor={t.green} style={{ backgroundColor: t.onBrand, borderColor: t.onBrand, minHeight: 60 }} />
          <Button title="View order" size="lg" kind="ghost" textColor={t.onBrand} onPress={() => { close(); router.replace("/partner/orders"); }} style={{ borderColor: t.onBrand, borderWidth: 1.5, minHeight: 56 }} />
        </View>
      </View>
    </Modal>
  );
}
