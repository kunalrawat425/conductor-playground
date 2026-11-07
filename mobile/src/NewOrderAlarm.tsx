import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, AppState, Modal, PanResponder, Pressable, Vibration, View } from "react-native";
import { slotDayLabel, slotTimeLabel } from "../../src/lib/delivery-slots";
import { router } from "expo-router";
import Constants from "expo-constants";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, getSession } from "./api";
import { CLOSED, planFor, qtyLabel, sellerPost } from "./partner";
import { stopRings } from "./ring";
import { useTheme } from "./theme";
import { Text } from "./ui/base";
import { Icon } from "./ui/icons";
import { pal } from "./theme/palette";

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
    // Dev only (QA of the ring screen): partner/orders?ring=1 rings the first waiting order regardless of age.
    const forced = __DEV__ && (globalThis as any).__rlfForceRing ? ((globalThis as any).__rlfForceRing = false, waiting[0]) : null;
    const fresh = forced || waiting.find((o) => !seen.current!.has(o.id));
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
  const addr = rows.map((r) => r.delivery_address).find(Boolean);
  const area = rows.map((r) => r.delivery_area).find(Boolean);
  const pre = order.is_preorder || order.placement_kind === "preorder" || order.status === "pre_order";
  const meta: [any, string][] = [
    ["pin", addr ? [addr.location_name, area?.km != null ? `${area.km} km` : ""].filter(Boolean).join(" · ") : area ? [area.name, area.km != null ? `${area.km} km` : ""].filter(Boolean).join(" · ") : order.order_type === "delivery" ? "Delivery" : "Pickup at your shop"],
    ["clock", `${pre ? "Pre-order" : "Same day"}${order.delivery_slot_start ? ` · ${slotTimeLabel(order.delivery_slot_start, order.delivery_slot_end)}, ${slotDayLabel(order.delivery_slot_start)}` : ""}`],
    ["user", `Buyer ••${String(order.buyer_phone || "").slice(-4)}`],
  ];
  const W = pal.white;
  // Rapido-style alarm (preview "Seller ring"): green full screen, countdown ring, slide to confirm.
  return (
    <Modal visible animationType="slide" onRequestClose={close} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: t.green, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 20, paddingHorizontal: 20, justifyContent: "space-between" }}>
        <View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
            <View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><Icon name="bell" size={16} color={W} /><Text style={{ fontSize: 14, fontWeight: "800", letterSpacing: 1.4, color: W }}>NEW ORDER</Text></View>
              <Text style={{ fontSize: 48, lineHeight: 56, fontWeight: "900", color: W, marginTop: 6 }}>₹{total.toLocaleString("en-IN")}</Text>
              <Text style={{ fontSize: 15, fontWeight: "600", color: W, opacity: 0.9 }}>{order.pay_on_delivery && !order.razorpay_payment_id ? "Pay on delivery" : "Paid online"} · {order.order_type === "delivery" ? "Delivery" : "Pickup"}</Text>
            </View>
          </View>
          <View style={{ marginTop: 18, backgroundColor: pal.a255_255_255_016, borderRadius: 12, padding: 14, gap: 6 }}>
            {(order.cart_items || [order]).map((r: any) => {
              const off = CLOSED.includes(r.status);
              return <View key={r.id} style={{ flexDirection: "row", justifyContent: "space-between" }}><Text style={{ fontSize: 17, fontWeight: "800", color: W, opacity: off ? 0.6 : 1, textDecorationLine: off ? "line-through" : "none", textTransform: "capitalize", flex: 1 }}>{r.listing?.species || r.species} · {qtyLabel(r)}</Text><Text style={{ fontSize: 17, fontWeight: "800", color: W, opacity: off ? 0.6 : 1, textDecorationLine: off ? "line-through" : "none" }}>₹{(Number(r.total_price || r.final_price) || 0).toLocaleString("en-IN")}</Text></View>;
            })}
          </View>
          <View style={{ marginTop: 16, gap: 6 }}>{meta.map(([ic, txt]) => <View key={ic} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Icon name={ic} size={16} color={W} /><Text style={{ fontSize: 15, fontWeight: "600", color: W }}>{txt}</Text></View>)}</View>
          {order.error ? <Text style={{ fontSize: 14, fontWeight: "700", color: W, marginTop: 14 }}>Couldn't accept: {order.error}</Text> : null}
        </View>
        <View style={{ gap: 12 }}>
          <SlideToConfirm busy={busy} onConfirm={accept} color={t.green} />
          <View style={{ flexDirection: "row", gap: 10 }}>
            {[["View order", () => { close(); router.replace("/partner/orders"); }], ["Can't fulfil", () => { close(); router.replace("/partner/orders"); }]].map(([label, fn]: any) => (
              <Pressable key={label} onPress={fn} style={{ flex: 1, height: 52, borderRadius: 12, borderWidth: 1.5, borderColor: W, alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 16, fontWeight: "800", color: W }}>{label}</Text></Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** White pill with a knob: drag it past 70 % to confirm (no accidental taps from a pocket). */
function SlideToConfirm({ onConfirm, busy, color }: { onConfirm: () => void; busy: boolean; color: string }) {
  const x = useRef(new Animated.Value(0)).current;
  const width = useRef(0);
  const KNOB = 52;
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderMove: (_, g) => x.setValue(Math.max(0, Math.min(g.dx, width.current - KNOB - 8))),
    onPanResponderRelease: (_, g) => {
      if (g.dx > (width.current - KNOB) * 0.7) { Animated.timing(x, { toValue: width.current - KNOB - 8, duration: 120, useNativeDriver: true }).start(() => onConfirm()); }
      else Animated.spring(x, { toValue: 0, useNativeDriver: true }).start();
    },
  })).current;
  return (
    <View onLayout={(e) => { width.current = e.nativeEvent.layout.width; }} accessibilityRole="button" accessibilityLabel="Slide to confirm" accessibilityActions={[{ name: "activate" }]} onAccessibilityAction={() => onConfirm()}
      style={{ height: 64, borderRadius: 32, backgroundColor: pal.white, justifyContent: "center" }}>
      <Text style={{ position: "absolute", alignSelf: "center", fontSize: 17, fontWeight: "800", color }}>{busy ? "Confirming…" : "Slide to confirm"}</Text>
      <Animated.View {...pan.panHandlers} style={{ marginLeft: 6, width: KNOB, height: KNOB, borderRadius: KNOB / 2, backgroundColor: color, alignItems: "center", justifyContent: "center", transform: [{ translateX: x }] }}>
        <Icon name="arrowRight" size={22} color={pal.white} />
      </Animated.View>
    </View>
  );
}
