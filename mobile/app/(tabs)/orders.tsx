import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { api, getSession } from "../../src/api";
import { rupees, useTheme } from "../../src/theme";
import { Button, Card, Loading, Pill, s, Text } from "../../src/ui";

const TONE: Record<string, "green" | "amber" | "red" | "grey" | "blue"> = {
  completed: "green", picked_up: "green", confirmed: "blue", out_for_delivery: "blue", ready_for_pickup: "blue", paid: "blue",
  pending_payment: "amber", pending: "amber", payment_required: "amber", cancelled: "red", declined: "red",
};
const NAME: Record<string, string> = {
  pending_payment: "Payment pending", pending: "Payment pending", paid: "Paid", confirmed: "Confirmed", out_for_delivery: "On the way",
  ready_for_pickup: "Ready", completed: "Delivered", picked_up: "Picked up", cancelled: "Cancelled", declined: "Declined", refunded: "Refunded", payment_required: "Final price in",
};

export default function Orders() {
  const t = useTheme();
  const [rows, setRows] = useState<any[] | null>(null);
  const [loggedIn, setLoggedIn] = useState(true);
  const load = useCallback(async () => {
    const me = await getSession();
    if (!me) { setLoggedIn(false); setRows([]); return; }
    setLoggedIn(true);
    const r = await api<{ orders: any[] }>(`/api/buyer/orders?buyer_id=${me.buyer_id}&page_size=50`).catch(() => ({ orders: [] }));
    // One card per checkout (a cart is several rows).
    const seen = new Set<string>();
    setRows(r.orders.filter((o) => { const k = o.cart_id || o.id; if (seen.has(k)) return false; seen.add(k); return true; }));
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  if (!rows) return <Loading />;
  if (!loggedIn) return (
    <View style={[s.center, { backgroundColor: t.page, padding: 24 }]}>
      <Text style={[s.h2, { color: t.ink, marginBottom: 12 }]}>Log in to see your orders</Text>
      <Button title="Log in" onPress={() => router.push("/login")} style={{ alignSelf: "stretch" }} />
    </View>
  );
  return (
    <FlatList
      style={{ backgroundColor: t.page }}
      data={rows}
      keyExtractor={(o) => o.id}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
      ListEmptyComponent={<Card><Text style={{ color: t.ink2 }}>No orders yet. Fresh fish is a tap away on Home.</Text></Card>}
      renderItem={({ item: o }) => {
        const podDue = o.pay_on_delivery && !o.razorpay_payment_id && !["completed", "cancelled", "declined", "refunded", "picked_up"].includes(o.status);
        return (
          <Pressable onPress={() => router.push(`/order/${o.id}`)}>
            <Card>
              <View style={[s.row, { justifyContent: "space-between" }]}>
                <Text style={[s.h2, { color: t.ink, textTransform: "capitalize", flex: 1 }]} numberOfLines={1}>{o.listing?.species || o.species}{o.cart_id ? " & more" : ""}</Text>
                <Text style={{ color: t.ink, fontWeight: "800" }}>{rupees((Number(o.total_price) || 0) + (Number(o.delivery_fee) || 0))}</Text>
              </View>
              <Text style={{ color: t.ink3, marginTop: 2 }}>{o.listing?.seller?.name} · {new Date(o.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</Text>
              <View style={[s.row, { gap: 6, marginTop: 8 }]}>
                <Pill text={o.pay_on_delivery && ["pending", "pending_payment"].includes(o.status) ? "Waiting for seller" : NAME[o.status] || o.status} tone={TONE[o.status] || "grey"} />
                {podDue ? <Pill text="Pay on delivery" tone="amber" /> : null}
              </View>
            </Card>
          </Pressable>
        );
      }}
    />
  );
}
