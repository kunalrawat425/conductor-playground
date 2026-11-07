/**
 * Your orders (preview "Orders list", web /track): Active · n / Past · n tabs. Arriving cards: seller, #id · items · total,
 * Pre-order / Pay on delivery tags, a 4-part progress bar (resolveBuyerStepper), the status + slot line, Track order /
 * Call us / Help. Past: delivered cards with Reorder / Rate / Invoice; cancelled as compact rows. Polls every 20 s.
 */
import { useCallback, useState } from "react";
import { ActivityIndicator, Image, Linking, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { api, getSession, type Session } from "../../src/api";
import { resolveBuyerStepper } from "../../../src/lib/buyer-order-stepper";
import { refundableAmount } from "../../../src/lib/order-payment-state";
import { orderSlotText } from "../../../src/lib/delivery-slots";
import { getSpeciesDisplay } from "../../../src/lib/species";
import { useTheme } from "../../src/theme";
import { ga } from "../../src/track";
import { AppHeader } from "../../src/ui/chrome";
import { EmptyState } from "../../src/ui/atoms";
import { lh, row, Text } from "../../src/ui/base";
import { Icon, type IconName } from "../../src/ui/icons";
import { CATEGORY_PHOTOS } from "../../src/ui/photos";

const TERM = ["declined", "cancelled", "refunded"];
const DONE = ["completed", "picked_up"];
const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" });
const qty = (o: any) => (o.quantity_unit === "kg" && Number(o.quantity) < 1 ? `${Math.round(Number(o.quantity) * 1000)} g` : `${o.quantity} ${o.quantity_unit === "kg" ? "kg" : o.quantity_unit}`);
const total = (o: any) => `₹${(Number(o.total_price || 0) + Number(o.delivery_fee || 0)).toLocaleString("en-IN")}`;
const photo = (o: any) => CATEGORY_PHOTOS[String(o.species || o.listing?.species || "").toLowerCase()] ?? CATEGORY_PHOTOS.all;
const STATUS: Record<string, string> = { pending: "Placed", pending_payment: "Waiting for payment", pre_order: "Pre-order placed", scheduled: "Scheduled", confirmed: "Confirmed", paid: "Paid, waiting for the seller", payment_required: "Final price is in", ready_for_pickup: "Ready for pickup", out_for_delivery: "Out for delivery" };

export default function Orders() {
  const t = useTheme();
  const [me, setMe] = useState<Session | null | undefined>(undefined);
  const [tab, setTab] = useState<"active" | "past">("active");
  const [data, setData] = useState<{ active: any[]; past: any[]; nA: number; nP: number } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    const s = await getSession(); setMe(s);
    if (!s) return;
    const q = (scope: string) => api<{ orders: any[]; total: number }>(`/api/buyer/orders?buyer_id=${encodeURIComponent(s.buyer_id!)}&scope=${scope}&page=1&page_size=20`).catch(() => ({ orders: [], total: 0 }));
    const [a, p] = await Promise.all([q("active"), q("past")]);
    setData({ active: a.orders, past: p.orders, nA: a.total, nP: p.total });
    setTab((cur) => (cur === "active" && !a.total && p.total ? "past" : cur));
  }, []);
  useFocusEffect(useCallback(() => { load(); const iv = setInterval(load, 20000); return () => clearInterval(iv); }, [load]));

  const card = { marginHorizontal: 16, padding: 14, backgroundColor: t.bg, borderWidth: 1, borderColor: t.border, borderRadius: 16 };
  const pill = (text: string, bg: string, fg: string) => <View style={{ backgroundColor: bg, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 9 }}><Text style={{ fontSize: 12, fontWeight: "700", color: fg }}>{text}</Text></View>;
  const btn = (label: string, icon: IconName | null, onPress: () => void, primary?: boolean) => (
    <Pressable key={label} onPress={onPress} style={[row, { gap: 6, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.5, borderColor: primary ? t.brand : t.border, backgroundColor: t.bg }]}>
      {icon ? <Icon name={icon} size={15} color={primary ? t.brand : t.ink} /> : null}<Text style={{ fontSize: 13, fontWeight: "700", color: primary ? t.brand : t.ink }}>{label}</Text>
    </Pressable>
  );
  const cap = (s: string) => <Text style={{ marginTop: 16, marginBottom: 8, marginHorizontal: 16, fontSize: 12, lineHeight: lh(12), fontWeight: "800", letterSpacing: 0.6, color: t.ink3 }}>{s}</Text>;

  function Active({ o }: { o: any }) {
    const delivery = o.order_type === "delivery";
    const { labels, step } = resolveBuyerStepper(o, delivery ? "delivery" : "pickup");
    const pre = o.is_preorder === true || o.placement_kind === "preorder" || o.status === "pre_order";
    const slot = delivery ? orderSlotText(o) : null;
    return (
      <Pressable onPress={() => router.push(`/order/${o.id}`)} style={card}>
        <View style={[row, { gap: 12 }]}>
          <Image source={photo(o)} style={{ width: 40, height: 40, borderRadius: 20 }} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 16, fontWeight: "800" }}>{o.listing?.seller?.name || "Seller"}</Text>
            <Text style={{ marginTop: 2, fontSize: 13, color: t.ink3 }}>#{o.id.slice(0, 8).toUpperCase()} · {qty(o)} {getSpeciesDisplay(o.species || o.listing?.species).split(" (")[0]} · {total(o)}</Text>
          </View>
          <View style={{ gap: 4, alignItems: "flex-end" }}>
            {pre ? pill("Pre-order", t.purpleL, t.purple) : null}
            {o.pay_on_delivery && !o.razorpay_payment_id ? pill("Pay on delivery", t.amberL, t.amber) : null}
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: 4, marginTop: 14 }}>{labels.map((_: string, i: number) => <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= step ? t.green : t.bg3 }} />)}</View>
        <View style={[row, { gap: 8, marginTop: 12, backgroundColor: t.brandL, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 12 }]}>
          <Icon name="calendar" size={16} color={t.brand} />
          <Text style={{ flex: 1, fontSize: 13, fontWeight: "700", color: t.brand }}>{STATUS[o.status] || labels[step] || o.status}{slot ? ` · ${slot.label.toLowerCase()} ${slot.value}` : ""}</Text>
        </View>
        <View style={[row, { gap: 8, marginTop: 12, flexWrap: "wrap" }]}>
          {btn("Track order", null, () => router.push(`/order/${o.id}`), true)}
          {btn("Call us", "phone", () => Linking.openURL("tel:+919152207607"))}
          {btn("Help", null, () => Linking.openURL("https://www.relifish.com/faq"))}
        </View>
      </Pressable>
    );
  }
  function Past({ o }: { o: any }) {
    if (TERM.includes(o.status)) {
      const owed = !o.refund_sent_at ? refundableAmount(o) : 0;
      return (
        <Pressable onPress={() => router.push(`/order/${o.id}`)} style={[card, row, { gap: 12 }]}>
          <Image source={photo(o)} style={{ width: 40, height: 40, borderRadius: 20 }} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15, fontWeight: "800" }}>{o.listing?.seller?.name || "Seller"} · {total(o)}</Text>
            <Text style={{ marginTop: 2, fontSize: 13, color: t.ink3 }}>{day(o.created_at)} · {owed > 0 ? `Refund ₹${owed.toLocaleString("en-IN")} on the way` : o.pay_on_delivery && !o.razorpay_payment_id ? "Not paid on delivery" : `${o.species || o.listing?.species || ""} ${qty(o)}`}</Text>
          </View>
          {pill(o.status === "declined" ? "Declined" : o.status === "refunded" ? "Refunded" : "Cancelled", t.redL, t.red)}
        </Pressable>
      );
    }
    return (
      <Pressable onPress={() => router.push(`/order/${o.id}`)} style={card}>
        <View style={[row, { gap: 12 }]}>
          <Image source={photo(o)} style={{ width: 40, height: 40, borderRadius: 20 }} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 16, fontWeight: "800" }}>{o.listing?.seller?.name || "Seller"}</Text>
            <Text style={{ marginTop: 2, fontSize: 13, color: t.ink3, textTransform: "capitalize" }}>{day(o.created_at)} · {o.species || o.listing?.species} {qty(o)} · {total(o)}</Text>
          </View>
          {pill(DONE.includes(o.status) ? (o.status === "picked_up" ? "Picked up" : "Delivered") : o.status, t.greenL, t.green)}
        </View>
        <View style={[row, { gap: 8, marginTop: 12 }]}>
          {btn("Reorder", "refresh", () => { ga("reorder_clicked", { order_id: o.id }); router.push(`/order/${o.id}`); }, true)}
          {btn("Rate", "star", () => Linking.openURL(`https://www.relifish.com/track/${o.id}`))}
          {btn("Invoice", "file", () => Linking.openURL(`https://www.relifish.com/track/${o.id}`))}
        </View>
      </Pressable>
    );
  }

  const list = tab === "active" ? data?.active ?? [] : data?.past ?? [];
  return (
    <View style={{ flex: 1, backgroundColor: t.bg2 }}>
      <AppHeader variant="page" title="Your orders" onBack={() => router.navigate("/")} />
      {me === undefined || (me && !data) ? <ActivityIndicator style={{ marginTop: 48 }} size="large" color={t.brand} /> : !me ? (
        <View style={{ marginTop: 16 }}><EmptyState icon="📋" title="Sign in to see your orders" desc="Use your phone number to view past orders and track current ones." cta="Sign in" onCta={() => router.push("/login")} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingTop: 12, paddingBottom: 16 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
          <View style={{ flexDirection: "row", marginHorizontal: 16, padding: 4, borderRadius: 12, backgroundColor: t.bg3 }}>
            {(["active", "past"] as const).map((k) => (
              <Pressable key={k} onPress={() => setTab(k)} style={{ flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 9, backgroundColor: tab === k ? t.bg : "transparent" }}>
                <Text style={{ fontSize: 14, fontWeight: tab === k ? "800" : "600", color: tab === k ? t.ink : t.ink3 }}>{k === "active" ? `Active · ${data!.nA}` : `Past · ${data!.nP}`}</Text>
              </Pressable>
            ))}
          </View>
          {!list.length ? (
            <View style={{ marginTop: 16 }}><EmptyState icon="📋" title={tab === "active" ? "Nothing on the way" : "No orders yet"} desc="Browse verified sellers near you to get started." cta="Browse sellers" onCta={() => router.navigate("/")} /></View>
          ) : tab === "active" ? (
            <>{cap("ARRIVING")}<View style={{ gap: 12 }}>{list.map((o) => <Active key={o.id} o={o} />)}</View></>
          ) : (
            <>{cap("PAST ORDERS")}<View style={{ gap: 12 }}>{list.map((o) => <Past key={o.id} o={o} />)}</View></>
          )}
        </ScrollView>
      )}
    </View>
  );
}
