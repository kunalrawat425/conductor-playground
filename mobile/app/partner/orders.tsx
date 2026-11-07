import { useCallback, useState } from "react";
import { Alert, FlatList, Linking, Modal, Platform, Pressable, RefreshControl, TextInput, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BADGE, CLOSED, planFor, qtyLabel, sellerPost, STATUS_FOR, type Act } from "../../src/partner";
import { POD_REFUSED_REASON } from "../../../src/lib/pay-on-delivery";
import { slotDayLabel, slotTimeLabel } from "../../../src/lib/delivery-slots";
import { font, radius, useTheme } from "../../src/theme";
import { api, getSession } from "../../src/api";
import { Button, Card, Loading, s, Text } from "../../src/ui";
import { paymentMethodLabel } from "../../../src/lib/order-payment-state";
import { DashboardHero, DashboardTabs } from "../../src/ui/chrome";
import { KpiStrip, PrepList, SellerOrderCard, type OcBadge } from "../../src/ui/dashboard";

const RANGES = [["Today", 1], ["Last 7 days", 7], ["Last 30 days", 30], ["All time", 0]] as const;
const TYPES = ["All", "Delivery", "Pickup", "Pre-order"] as const;
const BTONE: Record<string, OcBadge["tone"]> = { blue: "new", purple: "preorder", amber: "urgent", green: "paid", red: "urgent", grey: "done" };

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
  const [q, setQ] = useState("");
  const [range, setRange] = useState(2);
  const [type, setType] = useState(0);

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
  // Next delivery slot among open orders, and what to prepare for it (preview "Prep list").
  const open = data.orders.filter((o) => !CLOSED.includes(o.status) && o.delivery_slot_start && Date.parse(o.delivery_slot_start) > Date.now() - 3600_000);
  const nextSlot = open.map((o) => o.delivery_slot_start).sort()[0] as string | undefined;
  const nextEnd = open.find((o) => o.delivery_slot_start === nextSlot)?.delivery_slot_end;
  const prepMap = new Map<string, number>();
  for (const o of open.filter((x) => x.delivery_slot_start === nextSlot)) for (const r of (o.cart_items || [o]).filter((x: any) => !CLOSED.includes(x.status))) {
    const k = `${r.listing?.species || r.species} · ${r.pricing_label || qtyLabel(r)}`; prepMap.set(k, (prepMap.get(k) || 0) + 1);
  }
  const prep: [string, string][] = [...prepMap].map(([k, n]) => { const [sp, size] = k.split(" · "); return [sp, `${n} × ${size}`]; });
  // Web filter bar: search by order ID or the buyer's last 4 digits; date range; type.
  const days = RANGES[range][1];
  const shown = data.orders.filter((o) => {
    const k = q.trim().toLowerCase();
    if (k && !String(o.id).toLowerCase().startsWith(k.replace(/^#/, "")) && !String(o.buyer_phone || "").endsWith(k)) return false;
    if (days && Date.now() - new Date(o.created_at).getTime() > days * 86400_000) return false;
    const ty = TYPES[type];
    if (ty === "Delivery" && o.order_type !== "delivery") return false;
    if (ty === "Pickup" && o.order_type === "delivery") return false;
    if (ty === "Pre-order" && !(o.is_preorder || o.placement_kind === "preorder" || o.status === "pre_order")) return false;
    return true;
  });
  const kind = { primary: "primary", danger: "danger", secondary: "secondary", success: "primary" } as const;
  return (
    <View style={{ flex: 1, backgroundColor: t.page }}>
      <DashboardHero shop={name || "seller"} statsOpen={stats} onStats={() => setStats(!stats)} />
      <View style={{ backgroundColor: "#10B981" }}><KpiStrip items={[{ v: String(data.counts?.pending ?? 0), l: "to confirm" }, { v: String(data.counts?.accepted ?? 0), l: "in progress" }, stats ? { v: `₹${(data.today_gmv || 0).toLocaleString("en-IN")}`, l: "today" } : { v: nextSlot ? slotDayLabel(nextSlot).replace(/^(\w+) (\d+).*/, "$1 $2") : "None", l: "next slot" }]} /></View>
      <DashboardTabs active={tab} onTab={(k) => { setTab(k); setData({ ...data, orders: [] }); load(k); }}
        tabs={TABS.map(([k, label]) => ({ key: k, label, count: (k === "completed" ? (data.counts?.completed || 0) + (data.counts?.declined || 0) : data.counts?.[k] || 0) || undefined }))}
        search={q} onSearch={setQ} range={RANGES[range][0]} type={TYPES[type]} onRange={() => setRange((range + 1) % RANGES.length)} onType={() => setType((type + 1) % TYPES.length)}
        onCsv={() => Linking.openURL("https://www.relifish.com/dashboard/orders")} countText={`${shown.length} ${tab === "pending" ? "pending" : tab === "accepted" ? "in progress" : "orders"}`} />
      <PrepList title={`Prep list${nextSlot ? ` · ${slotDayLabel(nextSlot)}, ${slotTimeLabel(nextSlot, nextEnd)}` : ""}`} rows={prep} />
      <FlatList
        data={shown}
        keyExtractor={(o) => o.id}
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
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
          const pre = o.is_preorder || o.placement_kind === "preorder" || o.status === "pre_order";
          const lineBadge = (r: any): OcBadge | undefined => { const x = BADGE[r.status]; return o.cart_items && x ? { text: x[0], tone: BTONE[x[1]] } : undefined; };
          const tone = { green: [t.greenBg, t.green], amber: [t.amberL, t.amber], purple: [t.purpleL, t.purple], grey: [t.bg3, t.ink2] } as const;
          const extra = (
            <>
              {plan.note && plan.note.tone !== "green" ? <View style={{ padding: 10, borderRadius: 8, backgroundColor: tone[plan.note.tone][0] }}><Text style={{ fontSize: 12, fontWeight: "600", lineHeight: 17, color: tone[plan.note.tone][1] }}>{plan.note.text}</Text></View> : null}
              {o.delivery_slot_start ? <Text style={{ fontSize: 12, fontWeight: "600", color: t.ink2 }}>🕒 {slotTimeLabel(o.delivery_slot_start, o.delivery_slot_end)}, {slotDayLabel(o.delivery_slot_start)}</Text> : null}
              {o.cut_style || o.buyer_notes ? <Text style={{ fontSize: 11, fontWeight: "500", color: t.ink2 }}>{[o.cut_style ? `✂️ ${o.cut_style}` : "", o.buyer_notes ? `📝 ${o.buyer_notes}` : ""].filter(Boolean).join(" · ")}</Text> : null}
              {addr ? <Pressable onPress={() => Linking.openURL(addr.lat && addr.lng ? `https://www.google.com/maps/dir/?api=1&destination=${addr.lat},${addr.lng}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(where)}`)}><Text style={{ fontSize: 12, fontWeight: "600", color: t.link }}>Open in Maps →</Text></Pressable> : null}
              {o.cancel_reason && ["cancelled", "declined"].includes(o.status) ? <Text style={{ fontSize: 12, color: t.ink2 }}>Reason: {o.cancel_reason}</Text> : null}
              {plan.finalPrice ? (
                <View style={[s.row, { gap: 8 }]}>
                  <TextInput value={price[o.id] || ""} onChangeText={(v) => setPrice({ ...price, [o.id]: v.replace(/[^\d.]/g, "") })} keyboardType="numeric" placeholder="Final price (₹)" placeholderTextColor={t.ink4}
                    style={{ flex: 1, minHeight: 40, borderWidth: 1.5, borderColor: t.border, borderRadius: radius.sm, paddingHorizontal: 10, color: t.ink, backgroundColor: t.card, ...font(500) }} />
                  <Button title="Set price" size="sm" onPress={() => run(o, { action: "set_final_price", label: "", kind: "primary" })} loading={busy === o.id + "set_final_price"} />
                </View>
              ) : null}
            </>
          );
          return (
            <View testID={`order-${o.id}`} style={{ marginBottom: 12 }}>
              <SellerOrderCard
                id={`#${String(o.id).slice(0, 8).toUpperCase()}${o.buyer_phone ? ` · ${String(o.buyer_phone).slice(-4)}` : ""}`}
                time={new Date(o.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                badges={[...(o.razorpay_payment_id && !CLOSED.includes(o.status) && o.status !== "paid" ? [{ text: "Paid", tone: "paid" as const }] : []), { text: bt, tone: BTONE[bk] }]}
                itemsLine={rows.length > 1 ? `${rows.length} items` : undefined}
                lines={rows.map((r) => ({ text: `${r.listing?.species || r.species} · ${qtyLabel(r)}${r.pricing_label ? ` · ${r.pricing_label}` : ""}`, price: `₹${(Number(r.total_price || r.final_price) || 0).toLocaleString("en-IN")}`, badge: lineBadge(r), struck: !!o.cart_items && CLOSED.includes(r.status) }))}
                tags={[{ text: pre ? "Pre-order" : "Same day", kind: pre ? "preorder" : "order" }, { text: o.order_type === "delivery" ? "Delivery" : "Pickup", kind: o.order_type === "delivery" ? "delivery" : "pickup" }]}
                location={where || undefined} locationNote={!addr && area ? "(full address after you accept)" : undefined}
                total={`₹${total.toLocaleString("en-IN")}`} payment={paymentMethodLabel(o) || undefined} paymentRef={o.razorpay_payment_id || undefined}
                next={plan.hint || undefined} paidLine={plan.note?.tone === "green" ? plan.note.text : undefined}
                actions={plan.acts.map((a) => ({ title: busy === o.id + a.action ? "…" : a.label, kind: a.kind === "success" ? "green" : (a.kind as any), disabled: a.disabled, onPress: () => press(o, a) }))}
                extra={extra}
                waiting={plan.acts.some((a) => a.action === "accept") ? (() => { const m = Math.max(0, Math.floor((Date.now() - Date.parse(o.created_at)) / 1000)); return m >= 3600 ? `${Math.floor(m / 3600)} h ${Math.floor((m % 3600) / 60)} min` : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`; })() : undefined}
                paid={o.razorpay_payment_id ? `₹${total.toLocaleString("en-IN")}` : undefined} />
            </View>
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
