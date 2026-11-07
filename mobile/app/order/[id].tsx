import { PushPrePrompt } from "../../src/PushPrePrompt";
import { ga, track } from "../../src/track";
import { useCallback, useEffect, useState } from "react";
import { Alert, Linking, RefreshControl, ScrollView, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { api, getSession } from "../../src/api";
import { payOrder } from "../../src/pay";
import { resolveBuyerStepper } from "../../../src/lib/buyer-order-stepper";
import { paymentMethodLabel } from "../../../src/lib/order-payment-state";
import { cancelledByText, cancelReasonText } from "../../../src/lib/order-cancel";
import { rupees, useTheme } from "../../src/theme";
import { useCart } from "../../src/cart";
import { formatOptionMenuLabel, getListingPriceOptions, optionBundleAmount } from "../../../src/lib/listing-pricing";
import { cleanSellerName, stripContactInfo } from "../../../src/lib/seller-display";
import { areaNameForPoint } from "../../../src/lib/areas";
import { AppHeader, BottomNav, BUYER_NAV } from "../../src/ui/chrome";
import { BillSummary, InfoSection, Stepper, StatusHero } from "../../src/ui/orders";
import { Button } from "../../src/ui/atoms";
import { lh, row, Text } from "../../src/ui/base";
import { ActivityIndicator, Pressable } from "react-native";

const LABEL: Record<string, string> = {
  pending: "Almost done", pending_payment: "Almost done", pre_order: "Pre-order placed", confirmed: "Confirmed ✓",
  paid: "Paid, waiting for confirmation", payment_required: "Final price is in", ready_for_pickup: "Ready for pickup",
  out_for_delivery: "Out for delivery", picked_up: "Picked up", completed: "Delivered", declined: "Declined", cancelled: "Cancelled", refunded: "Refund processed",
};
const DONE = ["completed", "picked_up", "cancelled", "declined", "refunded"];

export default function OrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const [o, setO] = useState<any>(null);
  const [pod, setPod] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const cart = useCart();

  const load = useCallback(async () => {
    const me = await getSession();
    if (!me) return router.replace("/login");
    const r = await api<{ order: any }>(`/api/orders/detail?id=${id}&buyer_id=${me.buyer_id}`);
    setO(r.order);
    const unpaid = ["pending", "pending_payment"].includes(r.order.status) && !r.order.pay_on_delivery && !r.order.razorpay_payment_id;
    // Pay on delivery isn't on every server yet: no endpoint = just Pay now.
    setPod(unpaid ? await api(`/api/orders/pay-on-delivery?order_id=${id}&buyer_id=${me.buyer_id}`).catch(() => null) : null);
  }, [id]);
  useEffect(() => { load(); const iv = setInterval(load, 15000); return () => clearInterval(iv); }, [load]);
  if (!o) return <View style={{ flex: 1, backgroundColor: t.bg2 }}><AppHeader variant="page" title="Order details" onBack={() => router.back()} /><ActivityIndicator style={{ marginTop: 48 }} size="large" color={t.brand} /></View>;

  const items: any[] = o.cart?.items?.filter((i: any) => !["cancelled", "declined"].includes(i.status)) || [o];
  const fee = items.reduce((n, i) => n + (Number(i.delivery_fee) || 0), 0);
  const subtotal = items.reduce((n, i) => n + (Number(i.total_price) || 0), 0);
  const podDue = o.pay_on_delivery && !o.razorpay_payment_id && !DONE.includes(o.status);
  const due = o.cart ? Number(o.cart.payable_total) || 0 : (o.pay_on_delivery && o.final_price != null ? Number(o.final_price) : Number(o.total_price)) + Number(o.delivery_fee || 0);
  const unpaidNew = ["pending", "pending_payment"].includes(o.status) && !o.razorpay_payment_id;
  const steps = resolveBuyerStepper(o, o.order_type === "delivery" ? "delivery" : "pickup");
  const closed = ["cancelled", "declined"].includes(o.status);
  const heroColor = closed ? t.red : unpaidNew && !o.pay_on_delivery ? t.amber : t.green;

  async function pay() {
    setBusy("pay"); track("pay_opened"); ga("payment_started", { order_id: o.id, value: due });
    try {
      const r = await payOrder(o.id);
      if (r === "cancelled") ga("payment_dismissed", { order_id: o.id });
      if (r !== "cancelled") Alert.alert("Payment received", "Thank you! We'll keep you posted.");
      await load();
    } catch (e: any) { ga("payment_failed", { order_id: o.id }); Alert.alert("Payment", e.message); } finally { setBusy(null); }
  }
  async function choosePod() {
    setBusy("pod");
    try {
      const me = await getSession();
      await api("/api/orders/pay-on-delivery", { order_id: o.id, buyer_id: me!.buyer_id });
      ga("pay_on_delivery_chosen", { order_id: o.id });
      await load();
    } catch (e: any) {
      if (e.data?.block?.code === "open_order") setPod({ eligible: false, block: e.data.block });
      else Alert.alert("Pay on delivery", e.message);
    } finally { setBusy(null); }
  }
  function cancel() {
    Alert.prompt?.("Cancel order", "Why are you cancelling?", async (reason) => doCancel(reason || "Changed my mind"))
      ?? Alert.alert("Cancel this order?", "", [{ text: "Keep it" }, { text: "Cancel order", style: "destructive", onPress: () => doCancel("Changed my mind") }]);
  }
  async function doCancel(reason: string) {
    setBusy("cancel");
    try {
      const me = await getSession();
      await api("/api/orders/cancel", { order_id: o.id, buyer_id: me!.buyer_id, action: "cancel", cancel_reason: reason, whole_cart: true });
      await load();
    } catch (e: any) { Alert.alert("Cancel", e.message); } finally { setBusy(null); }
  }

  const tone = closed ? "red" : ["confirmed", "paid", "ready_for_pickup", "out_for_delivery", "picked_up", "completed"].includes(o.status) ? "green" : ["pending_payment", "payment_required"].includes(o.status) && !o.pay_on_delivery ? "amber" : o.status === "refunded" ? "indigo" : o.status === "pre_order" ? "purple" : "brand";
  const statusText = o.pay_on_delivery && unpaidNew ? "Waiting for the seller" : closed ? (o.status === "declined" ? "Declined" : "Cancelled") : LABEL[o.status] || o.status;
  const sellerArea = areaNameForPoint(o.seller?.lat, o.seller?.lng) || stripContactInfo(o.seller?.location_name) || "";
  const addr = o.delivery_address || o.address || null;
  const finalPrice = o.final_price != null && Number(o.final_price) !== Number(o.total_price) ? Number(o.final_price) : null;
  function reorder() {
    ga("reorder_clicked", { order_id: o.id });
    const sid = o.seller?.id || o.listing?.seller_id;
    for (const i of items) {
      const L = i.listing || o.listing; if (!L) continue;
      const opts = getListingPriceOptions(L); const k = Math.max(0, opts.findIndex((x: any) => x.id === i.pricing_option_id)); const opt: any = opts[k]; if (!opt) continue;
      const bundle = optionBundleAmount(opt) || 1;
      cart.setPacks({ id: sid, name: o.seller?.name || "" }, { listing_id: L.id, species: L.species, option_id: opt.id || `opt_${k}`, option_label: opt.label || formatOptionMenuLabel(opt), unit: opt.unit || "kg", bundle, price: Number(opt.price) || 0 }, Math.max(1, Math.round(Number(i.quantity) / bundle)));
    }
    router.push(`/seller/${sid}`);
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg2 }}>
      <AppHeader variant="page" title="Order details" onBack={() => (router.canGoBack() ? router.back() : router.replace("/orders"))} />
      <ScrollView contentContainerStyle={{ paddingBottom: 24, gap: 12 }} refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
        <StatusHero status={statusText} id={`#${String(o.id).slice(0, 8).toUpperCase()}`} time={new Date(o.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} tone={tone as any} />
        <InfoSection>
          <Stepper size={26} labelSize={9} failLine={t.green} steps={closed ? [{ label: "Placed", state: "done" }, { label: o.status === "declined" ? "Declined" : "Cancelled", state: "fail" }] : steps.labels.map((l: string, i: number) => ({ label: l, state: i <= steps.step ? "done" : "todo" as const }))} />
        </InfoSection>
        <InfoSection title="From">
          <Text style={{ fontSize: 14, lineHeight: lh(14), fontWeight: "700" }}>{cleanSellerName(o.seller?.name) || "Seller"}</Text>
          {sellerArea ? <Text style={{ marginTop: 2, fontSize: 12, lineHeight: lh(12), color: t.ink2 }}>{sellerArea}</Text> : null}
        </InfoSection>
        <InfoSection title="Items">
          {items.map((i: any, k: number) => (
            <View key={i.id || k} style={[row, { justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: k < items.length - 1 ? 1 : 0, borderBottomColor: t.border }]}>
              <View><Text style={{ fontSize: 13, fontWeight: "600", textTransform: "capitalize" }}>{i.species || o.listing?.species}</Text><Text style={{ marginTop: 2, fontSize: 11, color: t.ink3 }}>{i.pricing_label || (i.quantity_unit === "kg" && Number(i.quantity) < 1 ? `${Math.round(Number(i.quantity) * 1000)} grams` : `${i.quantity} ${i.quantity_unit}`)}</Text></View>
              <Text style={{ fontSize: 13, fontWeight: "700" }}>{rupees(Number(i.total_price) || 0)}</Text>
            </View>
          ))}
        </InfoSection>
        {o.order_type === "delivery" ? (
          <InfoSection title="Deliver to">
            <Text style={{ fontSize: 13, fontWeight: "700" }}>{addr?.label || "Home"}</Text>
            <Text style={{ marginTop: 2, fontSize: 12, color: t.ink2 }}>{addr ? [addr.flat, addr.building, addr.landmark, addr.location_name].filter(Boolean).join(", ") : o.buyer_addr || ""}</Text>
          </InfoSection>
        ) : null}
        <BillSummary rows={[{ k: "Subtotal", v: rupees(subtotal) }, ...(fee > 0 ? [{ k: "Delivery", v: rupees(fee) }] : []), { k: "Total", v: rupees(subtotal + fee), strong: true, rule: true }, ...(finalPrice != null ? [{ k: "Final price", v: rupees(finalPrice), rule: true }] : [])]} note={paymentMethodLabel(o) || "Payment pending"} />

        {unpaidNew && !o.pay_on_delivery ? (
          <InfoSection>
            <Text style={{ fontSize: 15, fontWeight: "800" }}>How would you like to pay?</Text>
            <Text style={{ marginTop: 4, fontSize: 12, color: t.ink3 }}>Pay within 2 hours, or the order is cancelled.</Text>
            <Button title={`Pay ${rupees(due)} now`} full onPress={pay} loading={busy === "pay"} style={{ marginTop: 14 }} />
            {pod?.eligible ? (
              <>
                <Text style={{ textAlign: "center", color: t.ink3, marginVertical: 8 }}>or</Text>
                <Button title={`Pay ${rupees(Number(pod.amount) || due)} on delivery`} variant="secondary" full onPress={choosePod} loading={busy === "pod"} />
                <Text style={{ textAlign: "center", color: t.ink3, fontSize: 12, marginTop: 6 }}>Pay in the Relifish app when your fish arrives. No cash.</Text>
              </>
            ) : pod?.block?.code === "open_order" ? (
              <View style={{ marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: t.amberL }}>
                <Text style={{ color: t.amber }}>You already have a pay-on-delivery order #{String(pod.block.order_id).slice(0, 8).toUpperCase()}. Pay or cancel it to use pay on delivery again.</Text>
                <Button title="Open that order →" variant="ghost" onPress={() => router.push(`/order/${pod.block.order_id}`)} />
              </View>
            ) : pod?.block?.code === "over_limit" ? <Text style={{ textAlign: "center", color: t.ink3, fontSize: 12, marginTop: 8 }}>{pod.block.message}</Text> : null}
          </InfoSection>
        ) : null}
        {o.pay_on_delivery && unpaidNew ? (
          <InfoSection>
            <Text style={{ fontSize: 15, fontWeight: "800", color: t.green }}>✅ Order placed</Text>
            <Text style={{ marginTop: 4, color: t.ink2 }}>Waiting for {o.seller?.name || "the seller"} to confirm. You'll pay {rupees(due)} here in the app when your fish arrives. No cash accepted.</Text>
            <Button title={`Pay ${rupees(due)} now instead`} variant="secondary" full onPress={pay} loading={busy === "pay"} style={{ marginTop: 12 }} />
          </InfoSection>
        ) : null}
        {podDue && ["confirmed", "ready_for_pickup", "out_for_delivery"].includes(o.status) ? (
          <InfoSection>
            <Text style={{ fontSize: 15, fontWeight: "800" }}>{o.status === "out_for_delivery" ? "🛵 Pay when your fish arrives" : "💵 You pay on delivery"}</Text>
            <Text style={{ marginTop: 4, color: t.ink2 }}>Pay here in the app (UPI or card) when your fish arrives. No cash accepted.</Text>
            <Button title={`Pay ${rupees(due)}`} full onPress={pay} loading={busy === "pay"} style={{ marginTop: 12 }} />
          </InfoSection>
        ) : null}
        {closed && cancelReasonText(o.cancel_reason) ? <View style={{ marginHorizontal: 16 }}><Text style={{ fontSize: 12, color: t.ink3 }}>{cancelledByText(o.cancelled_by, "buyer", o.cancel_reason)} · Reason: {cancelReasonText(o.cancel_reason)}</Text></View> : null}
        <View style={{ marginHorizontal: 16, gap: 12 }}>
          {unpaidNew ? <Pressable onPress={cancel} style={{ padding: 14, borderRadius: 12, borderWidth: 1, borderColor: t.redL, backgroundColor: t.bg, alignItems: "center" }}><Text style={{ fontSize: 14, fontWeight: "700", color: t.red }}>{busy === "cancel" ? "Cancelling…" : "Cancel order"}</Text></Pressable> : null}
          {DONE.includes(o.status) ? <Pressable onPress={reorder} style={{ padding: 14, borderRadius: 12, backgroundColor: t.brand, alignItems: "center" }}><Text style={{ fontSize: 14, fontWeight: "700", color: "#FFFFFF" }}>Re-order from {cleanSellerName(o.seller?.name) || "this seller"}</Text></Pressable> : null}
          <Button title="📞 Call us about this order" variant="secondary" full onPress={() => Linking.openURL("tel:+919152207607")} />
        </View>
      </ScrollView>
      <PushPrePrompt />
      <BottomNav items={BUYER_NAV} active="orders" onPress={(k) => router.navigate(k === "home" ? "/" : `/${k}` as any)} />
    </View>
  );
}
