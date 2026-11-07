/**
 * Your Orders = the site's /track (src/pages/track.astro): page header, cards from /api/buyer/orders (10 per page),
 * terminated orders as the red card, live ones as the blue active card with kind / method / payment / status pills,
 * the same stepper (resolveBuyerStepper), slot and refund lines, Prev / Next. Polls every 20 s like the site.
 */
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { api, getSession, type Session } from "../../src/api";
import { resolveBuyerStepper } from "../../../src/lib/buyer-order-stepper";
import { refundableAmount, wasActuallyPaid } from "../../../src/lib/order-payment-state";
import { orderSlotText } from "../../../src/lib/delivery-slots";
import { useTheme } from "../../src/theme";
import { AppHeader } from "../../src/ui/chrome";
import { ActiveOrderCard, BuyerOrderCard, OrderPill, type StepDot } from "../../src/ui/orders";
import { Badge } from "../../src/ui/shop";
import { EmptyState } from "../../src/ui/atoms";
import { Text } from "../../src/ui/base";

const STATUS: Record<string, [string, "orange" | "brand" | "green" | "red" | "indigo"]> = {
  pending: ["Pending", "orange"], pending_payment: ["Payment pending", "orange"], confirmed: ["Confirmed", "brand"], paid: ["Paid", "brand"],
  ready_for_pickup: ["Ready for pickup", "green"], out_for_delivery: ["Out for delivery", "brand"], picked_up: ["Picked up", "green"], completed: ["Completed", "green"],
  declined: ["Declined", "red"], cancelled: ["Cancelled", "red"], refunded: ["Refunded", "red"], scheduled: ["Scheduled", "indigo"], pre_order: ["Pre-order", "indigo"],
};
const TERM = ["declined", "cancelled", "refunded"];
const fmtDate = (iso: string) => {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d === 0 ? "Today" : d === 1 ? "Yesterday" : d < 7 ? `${d} days ago` : new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });
};
function qtyLabel(o: any) {
  const opt = (o.listing?.pricing_options || []).find((x: any) => x?.id && x.id === o.pricing_option_id);
  const bundle = opt?.bundle_size > 0 ? Number(opt.bundle_size) : 1;
  const unit = o.quantity_unit || "kg";
  return unit === "piece" && bundle > 1 ? `${Math.round(Number(o.quantity) / bundle)} pack` : unit === "kg" && Number(o.quantity) > 0 && Number(o.quantity) < 1 ? `${Math.round(Number(o.quantity) * 1000)} grams` : `${o.quantity}${unit}`;
}
function payPill(o: any) {
  const awaiting = ["pending_payment", "pending"].includes(o.status);
  const text = o.status === "refunded" ? "Refunded" : TERM.includes(o.status) && wasActuallyPaid(o) ? (o.refund_sent_at ? "Refunded" : "Refund pending")
    : !awaiting && (wasActuallyPaid(o) || (o.payment_method === "razorpay" && o.razorpay_payment_id) || ["confirmed", "paid", "ready_for_pickup", "out_for_delivery", "picked_up", "completed"].includes(o.status)) ? "Paid" : "";
  if (!text) return null;
  return <OrderPill text={text} bg={text === "Paid" ? "#DCFCE7" : "#FEE2E2"} fg={text === "Paid" ? "#059669" : "#DC2626"} />;
}

export default function Orders() {
  const t = useTheme();
  const [me, setMe] = useState<Session | null | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ orders: any[]; total: number } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    const s = await getSession(); setMe(s);
    if (!s) return;
    const r = await api<{ orders: any[]; total: number }>(`/api/buyer/orders?buyer_id=${encodeURIComponent(s.buyer_id!)}&page=${page}&page_size=10`).catch(() => null);
    if (r) setData(r);
  }, [page]);
  useFocusEffect(useCallback(() => { load(); const iv = setInterval(load, 20000); return () => clearInterval(iv); }, [load]));
  useEffect(() => { load(); }, [page]); // eslint-disable-line
  const pages = Math.max(1, Math.ceil((data?.total || 0) / 10));

  return (
    <View style={{ flex: 1, backgroundColor: t.bg2 }}>
      <AppHeader variant="page" title="Your Orders" onBack={() => router.navigate("/")} />
      {me === undefined || (me && !data) ? <ActivityIndicator style={{ marginTop: 48 }} size="large" color={t.brand} /> : !me ? (
        <View style={{ marginTop: 16 }}><EmptyState icon="📋" title="Sign in to see your orders" desc="Use your phone number to view past orders and track current ones." cta="Sign in" onCta={() => router.push("/login")} /></View>
      ) : !data!.orders.length ? (
        <View style={{ marginTop: 16 }}><EmptyState icon="📋" title="No orders yet" desc="Browse verified sellers near you to get started." cta="Browse sellers" onCta={() => router.navigate("/")} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingTop: 12, paddingBottom: 16, gap: 12 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
          {data!.orders.map((o) => {
            const seller = o.listing?.seller?.name || "Seller";
            const delivery = o.order_type === "delivery";
            const [label, tone] = STATUS[o.status] || [o.status, "brand"];
            const go = () => router.push(`/order/${o.id}`);
            if (TERM.includes(o.status)) {
              const owed = !o.refund_sent_at ? refundableAmount(o) : 0;
              return <BuyerOrderCard key={o.id} onPress={go} status={label} tone="red" seller={seller} line={`Order #${o.id.slice(0, 8).toUpperCase()} · ${qtyLabel(o)} · ${fmtDate(o.created_at)}`} pills={payPill(o)}
                steps={[{ label: "Placed", state: "done" }, { label, state: "fail" }]} refund={owed > 0 ? `⏱ Refund ₹${owed.toLocaleString("en-IN")} within 5–7 working days to your original payment method` : null} />;
            }
            const { labels, step } = resolveBuyerStepper(o, delivery ? "delivery" : "pickup");
            const pre = o.is_preorder === true || o.placement_kind === "preorder" || o.status === "pre_order";
            const slot = delivery && !["completed", "picked_up"].includes(o.status) ? orderSlotText(o) : null;
            return <ActiveOrderCard key={o.id} onPress={go} seller={seller} sub={`Order #${o.id.slice(0, 8).toUpperCase()} · ${qtyLabel(o)} · ${delivery ? "🚲 Delivery" : "🧊 Pickup"}`} slot={slot ? `${slot.label}: ${slot.value}` : null}
              prep={o.cut_style || o.buyer_notes ? [o.cut_style ? `✂️ ${o.cut_style}` : "", o.buyer_notes ? `📝 ${o.buyer_notes}` : ""].filter(Boolean).join(" · ") : null}
              steps={labels.map((l: string, i: number): StepDot => ({ label: l, state: i <= step ? "done" : "todo" }))}
              pills={<>{pre ? <OrderPill text="Pre-order" bg="#F5F3FF" fg="#7C3AED" border="#DDD6FE" /> : <OrderPill text="Order" bg="#EFF6FF" fg="#1D4ED8" border="#BFDBFE" />}{delivery ? <OrderPill text="Delivery" bg="#ECFEFF" fg="#0E7490" border="#A5F3FC" /> : <OrderPill text="Pickup" bg="#FFFBEB" fg="#B45309" border="#FDE68A" />}{payPill(o)}<Badge text={label} color={tone} /></>} />;
          })}
          {pages > 1 ? (
            <View style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 12, paddingVertical: 12 }}>
              <Pressable disabled={page <= 1} onPress={() => setPage((p) => p - 1)}><Text style={{ fontWeight: "700", color: page <= 1 ? t.ink4 : t.brand }}>← Prev</Text></Pressable>
              <Text style={{ fontSize: 12, color: t.ink3 }}>Page {page} of {pages}</Text>
              <Pressable disabled={page >= pages} onPress={() => setPage((p) => p + 1)}><Text style={{ fontWeight: "700", color: page >= pages ? t.ink4 : t.brand }}>Next →</Text></Pressable>
            </View>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}
