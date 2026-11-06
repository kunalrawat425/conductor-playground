import { useCallback, useState } from "react";
import { Alert, FlatList, Linking, Modal, Platform, Pressable, RefreshControl, TextInput, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BADGE, CLOSED, planFor, qtyLabel, sellerPost, STATUS_FOR, type Act } from "../../src/partner";
import { POD_REFUSED_REASON } from "../../../src/lib/pay-on-delivery";
import { slotDayLabel, slotTimeLabel } from "../../../src/lib/delivery-slots";
import { font, radius, useTheme } from "../../src/theme";
import { api, getSession } from "../../src/api";
import { Badge, Button, Card, Loading, s, Text } from "../../src/ui";

const TABS = [["pending", "New"], ["accepted", "In Progress"], ["completed", "History"]] as const;
const ASK: Record<string, { title: string; note: string; ok: string }> = {
  decline: { title: "Can't fulfill this order?", note: "The order is declined and the buyer is refunded in full.", ok: "Decline · refund buyer" },
  seller_cancel: { title: "Cancel this order?", note: "The buyer is refunded in full.", ok: "Cancel · refund buyer" },
};

/** The website's /dashboard/orders: New / Active / History, the same cards, notes and buttons. */
export default function PartnerOrders() {
  const t = useTheme();
  const [tab, setTab] = useState<string>("pending");
  const [data, setData] = useState<{ orders: any[]; counts: Record<string, number>; today_gmv: number } | null>(null);
  const [busy, setBusy] = useState<string>("");
  const [ask, setAsk] = useState<{ o: any; act: Act } | null>(null);
  const [reason, setReason] = useState("");
  const [price, setPrice] = useState<Record<string, string>>({});
  const [stats, setStats] = useState(false);
  const [name, setName] = useState("");
  const insets = useSafeAreaInsets();

  const load = useCallback(async (which = tab) => {
    const me = await getSession();
    setName(me?.name || "");
    const r = await api(`/api/seller/orders?seller_id=${me?.seller_id}&tab=${which}`).catch((e) => { Alert.alert("Couldn't load orders", e.message); return null; });
    if (r) setData(r);
  }, [tab]);
  // Fresh on focus and every 20 s while open (the alarm in the layout rings for new ones).
  useFocusEffect(useCallback(() => { load(); const id = setInterval(() => load(), 20_000); return () => clearInterval(id); }, [load]));

  async function run(o: any, act: Act, cancel_reason?: string) {
    const isCart = !!o.cart_items;
    setBusy(o.id + act.action);
    try {
      if (act.action === "reconcile") {
        const r = await sellerPost("/api/seller/reconcile-razorpay", { order_id: o.id });
        Alert.alert(r?.ok ? (r.refunded ? "Payment found and refunded (order was closed)" : "Payment found, order confirmed") : r?.reason || "No payment yet");
      } else if (act.action === "set_final_price") {
        const n = Number(price[o.id]);
        if (!(n > 0)) { Alert.alert("Enter a valid final price"); return; }
        await sellerPost("/api/seller/orders", { order_id: o.id, action: "set_final_price", final_price: n });
      } else {
        await sellerPost("/api/seller/orders", { order_id: o.id, status: STATUS_FOR[act.action], ...(isCart ? { cart: true } : {}), ...(cancel_reason ? { cancel_reason } : {}) });
      }
      await load();
    } catch (e: any) {
      Alert.alert("Order action failed", e.message);
    } finally { setBusy(""); }
  }
  function press(o: any, act: Act) {
    if (ASK[act.action]) { setReason(""); setAsk({ o, act }); return; }
    if (act.action === "pod_refused") {
      const msg = "The order is cancelled, nothing was charged, and pay on delivery is switched off for this buyer.";
      // React Native Web has no Alert: the browser's confirm there.
      if (Platform.OS === "web") { if (globalThis.confirm?.(`Buyer didn't pay?\n${msg}`)) run(o, act, POD_REFUSED_REASON); return; }
      Alert.alert("Buyer didn't pay?", "The order is cancelled, nothing was charged, and pay on delivery is switched off for this buyer.", [
        { text: "Back", style: "cancel" }, { text: "Cancel order", style: "destructive", onPress: () => run(o, act, POD_REFUSED_REASON) },
      ]);
      return;
    }
    run(o, act);
  }

  if (!data) return <Loading />;
  const kind = { primary: "primary", danger: "danger", secondary: "secondary", success: "primary" } as const;
  return (
    <View style={{ flex: 1, backgroundColor: t.page }}>
      {/* .v2-dash-hero: green pipeline header with the stats toggle, then underlined tabs with red counts */}
      <LinearGradient colors={[t.green, "#10B981"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingTop: insets.top + 16, paddingHorizontal: 16, paddingBottom: 16 }}>
        <View style={[s.row, { justifyContent: "space-between" }]}>
          <View>
            <Text style={{ fontSize: 12, color: t.onBrand, opacity: 0.9 }}>Good day, {name || "seller"}</Text>
            <Text style={{ fontSize: 20, fontWeight: "800", color: t.onBrand, marginTop: 2 }}>Today's pipeline</Text>
          </View>
          <Pressable onPress={() => setStats(!stats)} style={{ backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 20, paddingVertical: 6, paddingHorizontal: 12 }}>
            <Text style={{ fontSize: 11, fontWeight: "600", color: t.onBrand }}>Stats {stats ? "▲" : "▼"}</Text>
          </Pressable>
        </View>
        {stats ? (
          <View style={[s.row, { gap: 8, marginTop: 12 }]}>
            {[[data.counts?.pending ?? 0, "New"], [data.counts?.accepted ?? 0, "In Progress"], [`₹${(data.today_gmv || 0).toLocaleString("en-IN")}`, "Today"]].map(([v, l]) => (
              <View key={l} style={{ flex: 1, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 10, padding: 10, alignItems: "center" }}>
                <Text style={{ fontSize: 18, fontWeight: "800", color: t.onBrand }}>{v}</Text>
                <Text style={{ fontSize: 10, fontWeight: "500", color: t.onBrand, opacity: 0.9, marginTop: 1 }}>{l}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </LinearGradient>
      <View style={[s.row, { backgroundColor: t.card, borderBottomWidth: 1, borderBottomColor: t.border }]}>
        {TABS.map(([k, label]) => {
          const on = tab === k;
          const n = k === "completed" ? (data.counts?.completed || 0) + (data.counts?.declined || 0) : data.counts?.[k] || 0;
          return (
            <Pressable key={k} onPress={() => { setTab(k); setData({ ...data, orders: [] }); load(k); }} style={{ flex: 1, height: 46, alignItems: "center", justifyContent: "center", borderBottomWidth: 2, borderBottomColor: on ? t.brand : "transparent", flexDirection: "row", gap: 6 }}>
              <Text style={{ fontSize: 12, fontWeight: "600", color: on ? t.brand : t.ink3 }}>{label}</Text>
              {n ? <View style={{ backgroundColor: t.red, borderRadius: 10, paddingHorizontal: 6, minWidth: 20, alignItems: "center" }}><Text style={{ fontSize: 11, fontWeight: "700", color: t.onBrand }}>{n}</Text></View> : null}
            </Pressable>
          );
        })}
      </View>
      <FlatList
        data={data.orders}
        keyExtractor={(o) => o.id}
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => load()} />}
        ListEmptyComponent={<Card><Text style={{ color: t.ink2 }}>{tab === "pending" ? "No new orders right now. Pull down to refresh." : "Nothing here yet."}</Text></Card>}
        renderItem={({ item: o }) => {
          const rows: any[] = o.cart_items || [o];
          const live = rows.filter((r) => !CLOSED.includes(r.status));
          const plan = planFor(o, o.cart_items);
          const total = (o.cart_items ? live : rows).reduce((n, r) => n + (Number(r.total_price || r.final_price) || 0) + (o.cart_items ? Number(r.delivery_fee) || 0 : 0), 0);
          const [bt, bk] = BADGE[o.status] || [o.status, "grey"];
          const addr = rows.map((r) => r.delivery_address).find(Boolean);
          const area = addr ? null : rows.map((r) => r.delivery_area).find(Boolean);
          const where = addr ? [addr.flat, addr.building, addr.landmark, addr.location_name].filter(Boolean).join(", ") : area ? [area.name, area.km != null ? `~${area.km} km away` : ""].filter(Boolean).join(" · ") : "";
          const tone = { green: [t.greenBg, t.green], amber: [t.amberSoft, t.amber], purple: [t.purpleSoft, t.purple], grey: [t.bg3, t.ink2] } as const;
          return (
            // .v2-seller-order inside #v2-orders-list (8 px list padding on the 16 px page gutter)
            <Card testID={`order-${o.id}`} style={{ marginHorizontal: 24, marginTop: 0, marginBottom: 12, shadowColor: "#0F172A", shadowOffset: { width: 0, height: 8 }, shadowRadius: 18, shadowOpacity: 0.06 }}>
              <View style={[s.row, { justifyContent: "space-between" }]}>
                <Text style={{ fontSize: 12, fontWeight: "700", color: t.ink3 }}>#{String(o.id).slice(0, 8).toUpperCase()} · {new Date(o.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</Text>
                <Badge text={bt} kind={bk} />
              </View>
              {rows.map((r) => (
                <View key={r.id} style={[s.row, { justifyContent: "space-between", marginTop: 8, gap: 8 }]}>
                  <Text style={{ flex: 1, fontSize: 14, fontWeight: "700", textTransform: "capitalize", ...(CLOSED.includes(r.status) && o.cart_items ? { textDecorationLine: "line-through", color: t.ink3 } : {}) }}>{r.listing?.species || r.species} · {qtyLabel(r)}</Text>
                  <Text style={{ fontSize: 14, fontWeight: "700" }}>₹{(Number(r.total_price || r.final_price) || 0).toLocaleString("en-IN")}</Text>
                </View>
              ))}
              <View style={[s.row, { justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: t.border }]}>
                <Text style={{ fontSize: 12, color: t.ink3 }}>{o.order_type === "delivery" ? "Delivery" : "Pickup"}{o.buyer_phone ? ` · buyer ••${o.buyer_phone}` : ""}</Text>
                <Text style={{ fontSize: 16, fontWeight: "800" }}>₹{total.toLocaleString("en-IN")}</Text>
              </View>
              {o.delivery_slot_start ? <Text style={{ fontSize: 12, fontWeight: "600", color: t.ink2, marginTop: 4 }}>🕒 {slotTimeLabel(o.delivery_slot_start, o.delivery_slot_end)}, {slotDayLabel(o.delivery_slot_start)}</Text> : null}
              {where ? (
                <Pressable disabled={!addr} onPress={() => Linking.openURL(addr?.lat && addr?.lng ? `https://www.google.com/maps/dir/?api=1&destination=${addr.lat},${addr.lng}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(where)}`)}>
                  <Text style={{ fontSize: 12, color: addr ? t.link : t.ink3, marginTop: 4 }}>📍 {where}</Text>
                </Pressable>
              ) : null}
              {o.cancel_reason && ["cancelled", "declined"].includes(o.status) ? <Text style={{ fontSize: 12, color: t.ink2, marginTop: 6 }}>Reason: {o.cancel_reason}</Text> : null}
              {plan.note ? <View style={{ marginTop: 10, padding: 10, borderRadius: radius.sm, backgroundColor: tone[plan.note.tone][0] }}><Text style={{ fontSize: 12, fontWeight: "600", lineHeight: 17, color: tone[plan.note.tone][1] }}>{plan.note.text}</Text></View> : null}
              {plan.hint ? <Text style={{ fontSize: 12, fontWeight: "600", color: t.ink3, marginTop: 8 }}>{plan.hint}</Text> : null}
              {plan.finalPrice ? (
                <View style={[s.row, { gap: 8, marginTop: 8 }]}>
                  <TextInput value={price[o.id] || ""} onChangeText={(v) => setPrice({ ...price, [o.id]: v.replace(/[^\d.]/g, "") })} keyboardType="numeric" placeholder="Final price (₹)" placeholderTextColor={t.ink4}
                    style={{ flex: 1, minHeight: 40, borderWidth: 1.5, borderColor: t.border, borderRadius: radius.sm, paddingHorizontal: 10, color: t.ink, backgroundColor: t.card, ...font(500) }} />
                  <Button title="Set price" size="sm" onPress={() => run(o, { action: "set_final_price", label: "", kind: "primary" })} loading={busy === o.id + "set_final_price"} />
                </View>
              ) : null}
              {plan.acts.length ? (
                <View style={{ gap: 8, marginTop: 10, flexDirection: plan.row ? "row" : "column" }}>
                  {plan.acts.map((a) => <Button key={a.action} title={a.label} size="sm" kind={kind[a.kind]} disabled={a.disabled} loading={busy === o.id + a.action} onPress={() => press(o, a)} style={{ ...(plan.row ? { flex: 1 } : {}), ...(a.kind === "success" && !a.disabled ? { backgroundColor: t.green, borderColor: t.green } : {}) }} />)}
                </View>
              ) : null}
            </Card>
          );
        }}
      />
      <Modal visible={!!ask} transparent animationType="fade" onRequestClose={() => setAsk(null)}>
        <View style={{ flex: 1, backgroundColor: "rgba(15,23,42,0.5)", justifyContent: "center", padding: 24 }}>
          <View style={{ backgroundColor: t.card, borderRadius: radius.lg, padding: 18 }}>
            <Text style={{ fontSize: 17, fontWeight: "800" }}>{ask && ASK[ask.act.action].title}</Text>
            <Text style={{ fontSize: 13, color: t.ink3, marginTop: 4 }}>{ask && ASK[ask.act.action].note}</Text>
            <Text style={{ fontSize: 12, fontWeight: "700", color: t.ink2, marginTop: 14 }}>Reason (the buyer sees this)</Text>
            <TextInput value={reason} onChangeText={setReason} multiline autoFocus placeholder="e.g. Didn't get this fish at the dock today"
              placeholderTextColor={t.ink4} style={{ minHeight: 70, marginTop: 6, borderWidth: 1.5, borderColor: t.border, borderRadius: radius.sm, padding: 10, color: t.ink, textAlignVertical: "top", ...font(400) }} />
            <View style={[s.row, { gap: 8, marginTop: 14 }]}>
              <Button title="Back" kind="secondary" onPress={() => setAsk(null)} style={{ flex: 1 }} />
              <Button title={ask ? ASK[ask.act.action].ok : ""} kind="danger" disabled={reason.trim().length < 3} onPress={() => { const a = ask!; setAsk(null); run(a.o, a.act, reason.trim()); }} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
