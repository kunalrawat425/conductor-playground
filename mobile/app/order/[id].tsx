import { useCallback, useEffect, useState } from "react";
import { Alert, Linking, RefreshControl, ScrollView, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { api, getSession } from "../../src/api";
import { payOrder } from "../../src/pay";
import { resolveBuyerStepper } from "../../../src/lib/buyer-order-stepper";
import { paymentMethodLabel } from "../../../src/lib/order-payment-state";
import { cancelledByText, cancelReasonText } from "../../../src/lib/order-cancel";
import { rupees, useTheme } from "../../src/theme";
import { Button, Card, Label, Loading, Pill, s, Text } from "../../src/ui";

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
  if (!o) return <Loading />;

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
    setBusy("pay");
    try {
      const r = await payOrder(o.id);
      if (r !== "cancelled") Alert.alert("Payment received", "Thank you! We'll keep you posted.");
      await load();
    } catch (e: any) { Alert.alert("Payment", e.message); } finally { setBusy(null); }
  }
  async function choosePod() {
    setBusy("pod");
    try {
      const me = await getSession();
      await api("/api/orders/pay-on-delivery", { order_id: o.id, buyer_id: me!.buyer_id });
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

  return (
    <ScrollView style={{ backgroundColor: t.page }} contentContainerStyle={{ paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
      <View style={{ margin: 16, marginBottom: 0, borderRadius: 18, padding: 18, backgroundColor: heroColor }}>
        <Text style={{ color: "#fff", fontSize: 22, fontWeight: "900" }}>
          {o.pay_on_delivery && unpaidNew ? "Waiting for the seller" : LABEL[o.status] || o.status}
        </Text>
        <Text style={{ color: "#fff", opacity: 0.9, marginTop: 4 }}>Order #{String(o.id).slice(0, 8).toUpperCase()}</Text>
        {podDue ? <View style={{ marginTop: 8 }}><Pill text="Pay on delivery" tone="amber" /></View> : null}
      </View>

      {!closed ? (
        <Card>
          <View style={[s.row, { justifyContent: "space-between" }]}>
            {steps.labels.map((l, i) => (
              <View key={l} style={{ alignItems: "center", flex: 1 }}>
                <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: i <= steps.step ? t.green : t.border, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: "#fff", fontWeight: "900", fontSize: 12 }}>{i <= steps.step ? "✓" : i + 1}</Text>
                </View>
                <Text style={{ color: t.ink3, fontSize: 10, marginTop: 4, textAlign: "center" }}>{l}</Text>
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      <Card>
        <Label>From {o.seller?.name || ""}</Label>
        {items.map((i) => (
          <View key={i.id || "one"} style={[s.row, { justifyContent: "space-between", marginTop: 4 }]}>
            <Text style={{ color: t.ink, textTransform: "capitalize", flex: 1 }}>{i.species || o.listing?.species} · {i.pricing_label || `${i.quantity} ${i.quantity_unit}`}</Text>
            <Text style={{ color: t.ink, fontWeight: "700" }}>{rupees(Number(i.total_price) || 0)}</Text>
          </View>
        ))}
        <View style={{ height: 1, backgroundColor: t.border, marginVertical: 10 }} />
        {fee > 0 ? <View style={[s.row, { justifyContent: "space-between" }]}><Text style={{ color: t.ink2 }}>Delivery</Text><Text style={{ color: t.ink }}>{rupees(fee)}</Text></View> : null}
        <View style={[s.row, { justifyContent: "space-between", marginTop: 4 }]}><Text style={[s.h2, { color: t.ink }]}>Total</Text><Text style={[s.h2, { color: t.ink }]}>{rupees(subtotal + fee)}</Text></View>
        <Text style={{ color: t.ink3, marginTop: 6, fontSize: 12 }}>{paymentMethodLabel(o) || "Payment pending"}</Text>
      </Card>

      {unpaidNew && !o.pay_on_delivery ? (
        <Card style={{ borderColor: t.brand, borderWidth: 1.5 }}>
          <Text style={[s.h2, { color: t.ink }]}>How would you like to pay?</Text>
          <Text style={{ color: t.ink3, marginTop: 4 }}>Pay within 2 hours, or the order is cancelled.</Text>
          <Button title={`Pay ${rupees(due)} now`} onPress={pay} loading={busy === "pay"} style={{ marginTop: 14 }} />
          {pod?.eligible ? (
            <>
              <Text style={{ textAlign: "center", color: t.ink3, marginVertical: 8 }}>or</Text>
              <Button title={`Pay ${rupees(Number(pod.amount) || due)} on delivery`} kind="secondary" onPress={choosePod} loading={busy === "pod"} />
              <Text style={{ textAlign: "center", color: t.ink3, fontSize: 12, marginTop: 6 }}>Pay in the Relifish app when your fish arrives. No cash.</Text>
            </>
          ) : pod?.block?.code === "open_order" ? (
            <View style={{ marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: t.amberSoft }}>
              <Text style={{ color: t.amber }}>You already have a pay-on-delivery order #{String(pod.block.order_id).slice(0, 8).toUpperCase()}. Pay or cancel it to use pay on delivery again.</Text>
              <Button title="Open that order →" kind="ghost" onPress={() => router.push(`/order/${pod.block.order_id}`)} />
            </View>
          ) : pod?.block?.code === "over_limit" ? (
            <Text style={{ textAlign: "center", color: t.ink3, fontSize: 12, marginTop: 8 }}>{pod.block.message}</Text>
          ) : null}
        </Card>
      ) : null}

      {o.pay_on_delivery && unpaidNew ? (
        <Card style={{ borderColor: t.green, borderWidth: 1.5 }}>
          <Text style={[s.h2, { color: t.green }]}>✅ Order placed</Text>
          <Text style={{ color: t.ink2, marginTop: 4 }}>Waiting for {o.seller?.name || "the seller"} to confirm. You'll pay {rupees(due)} here in the app when your fish arrives. No cash accepted.</Text>
          <Button title={`Pay ${rupees(due)} now instead`} kind="secondary" onPress={pay} loading={busy === "pay"} style={{ marginTop: 12 }} />
        </Card>
      ) : null}

      {podDue && ["confirmed", "ready_for_pickup", "out_for_delivery"].includes(o.status) ? (
        <Card style={{ borderColor: t.brand, borderWidth: 1.5 }}>
          <Text style={[s.h2, { color: t.ink }]}>{o.status === "out_for_delivery" ? "🛵 Pay when your fish arrives" : "💵 You pay on delivery"}</Text>
          <Text style={{ color: t.ink2, marginTop: 4 }}>Pay here in the app (UPI or card) when your fish arrives. No cash accepted.</Text>
          <Button title={`Pay ${rupees(due)}`} onPress={pay} loading={busy === "pay"} style={{ marginTop: 12 }} />
        </Card>
      ) : null}

      {closed ? (
        <Card style={{ borderColor: t.red }}>
          <Text style={[s.h2, { color: t.red }]}>{cancelledByText(o.cancelled_by, "buyer", o.cancel_reason)}</Text>
          {cancelReasonText(o.cancel_reason) ? <Text style={{ color: t.ink2, marginTop: 4 }}>Reason: {cancelReasonText(o.cancel_reason)}</Text> : null}
        </Card>
      ) : null}

      {unpaidNew ? <Button title="Cancel order" kind="danger" onPress={cancel} loading={busy === "cancel"} style={{ marginHorizontal: 16, marginTop: 12 }} /> : null}
      <Button title="📞 Call us about this order" kind="ghost" onPress={() => Linking.openURL("tel:+919152207607")} style={{ marginHorizontal: 16, marginTop: 6 }} />
    </ScrollView>
  );
}
