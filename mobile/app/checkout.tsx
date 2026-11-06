import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { api, getSession, supabase, type Session } from "../src/api";
import { useCart } from "../src/cart";
import { myLocation } from "../src/catalog";
import { SELLER_PUBLIC_COLUMNS } from "../../src/lib/seller-columns";
import { classifyPlacementAtOrderTime } from "../../src/lib/order-timing";
import { computeDeliveryFee, haversineKm } from "../../src/lib/order-pricing";
import { font, rupees, useTheme } from "../src/theme";
import { Button, Card, Label, Loading, s, Text } from "../src/ui";

type Address = { id: string; label?: string; flat?: string; building?: string; landmark?: string; location_name?: string; lat?: number; lng?: number; is_default?: boolean };
type Day = { date: string; kind: "same_day" | "preorder"; label: string; slots: { start: string; end: string; time: string }[] };

export default function Checkout() {
  const t = useTheme();
  const cart = useCart();
  const [me, setMe] = useState<Session | null | undefined>(undefined);
  const [seller, setSeller] = useState<any>(null);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [addr, setAddr] = useState<string | null>(null);
  const [days, setDays] = useState<Day[] | null>(null);
  const [slot, setSlot] = useState<{ start: string; kind: Day["kind"] } | null>(null);
  const [adding, setAdding] = useState(false);
  const [flat, setFlat] = useState(""); const [building, setBuilding] = useState(""); const [area, setArea] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");

  useFocusEffect(useCallback(() => { getSession().then(setMe); }, []));
  useEffect(() => {
    if (!cart.seller) return;
    supabase.from("sellers").select(SELLER_PUBLIC_COLUMNS).eq("id", cart.seller.id).maybeSingle().then(({ data }) => setSeller(data));
    api<{ delivery_days: Day[] | null }>(`/api/seller/fulfillment?seller_id=${cart.seller.id}`).then((f) => setDays(f.delivery_days)).catch(() => setDays(null));
  }, [cart.seller?.id]);
  useEffect(() => {
    if (!me) return;
    api<{ addresses: Address[] }>(`/api/buyer/addresses?buyer_id=${me.buyer_id}`).then((r) => {
      setAddresses(r.addresses);
      setAddr((cur) => cur || (r.addresses.find((a) => a.is_default) || r.addresses[0])?.id || null);
      if (!r.addresses.length) setAdding(true);
    }).catch(() => {});
  }, [me?.buyer_id]);

  if (!cart.seller) return <View style={[s.center, { backgroundColor: t.page }]}><Text style={{ color: t.ink2 }}>Your cart is empty.</Text></View>;
  if (me === undefined || !seller) return <Loading />;
  if (!me) return (
    <View style={{ flex: 1, backgroundColor: t.page, padding: 20, justifyContent: "center" }}>
      <Text style={[s.h1, { color: t.ink, textAlign: "center" }]}>Log in to order</Text>
      <Text style={{ color: t.ink3, textAlign: "center", marginVertical: 10 }}>Your cart stays as it is.</Text>
      <Button title="Log in with your number" onPress={() => router.push("/login")} />
    </View>
  );

  const delivery = !!seller.has_delivery;
  const chosen = addresses.find((a) => a.id === addr);
  const km = chosen?.lat != null && seller.lat != null ? haversineKm(Number(seller.lat), Number(seller.lng), Number(chosen.lat), Number(chosen.lng)) : undefined;
  const fee = computeDeliveryFee(seller, cart.total, delivery ? "delivery" : "pickup", km);
  const min = Number(seller.min_order_amount) || 0;
  const placement = slot?.kind || (classifyPlacementAtOrderTime(seller, Date.now()) as string);
  const needSlot = delivery && !!days?.length;
  const ready = (!delivery || !!addr) && (!needSlot || !!slot) && cart.total >= min && placement !== "closed";

  async function saveAddress() {
    setBusy(true); setErr("");
    try {
      const at = await myLocation();
      const r = await api<{ address: Address }>("/api/buyer/addresses", { buyer_id: me!.buyer_id, address: { label: "Home", flat, building, location_name: area, lat: at.fromPhone ? at.lat : null, lng: at.fromPhone ? at.lng : null, is_default: !addresses.length } });
      setAddresses((a) => [...a, r.address]); setAddr(r.address.id); setAdding(false);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function place() {
    setBusy(true); setErr("");
    try {
      const r = await api<{ orders: { id: string }[] }>("/api/orders/create-seller-cart", {
        seller_id: cart.seller!.id,
        lines: cart.lines.map((l) => ({ listing_id: l.listing_id, quantity: Math.round(l.bundle * l.packs * 1000) / 1000, quantity_unit: l.unit, pricing_option_id: l.option_id })),
        buyer_phone: me!.phone, buyer_id: me!.buyer_id, buyer_addr: delivery ? addr : null,
        order_type: delivery ? "delivery" : "pickup",
        delivery_slot_start: needSlot ? slot!.start : null,
        placement_kind: placement,
        utm: { utm_source: "app", utm_medium: "android" },
      });
      cart.clear();
      router.replace(`/order/${r.orders[0].id}`);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  const field = { borderWidth: 1.5, borderColor: t.border, borderRadius: 12, padding: 12, color: t.ink, backgroundColor: t.card, marginTop: 8, ...font(500) };

  return (
    <ScrollView style={{ backgroundColor: t.page }} contentContainerStyle={{ paddingBottom: 40 }}>
      <Card>
        <Label>Your order · {cart.seller.name}</Label>
        {cart.lines.map((l) => (
          <View key={l.listing_id + l.option_id} style={[s.row, { justifyContent: "space-between", marginTop: 6 }]}>
            <Text style={{ color: t.ink, flex: 1, textTransform: "capitalize" }}>{l.species} · {l.option_label} × {l.packs}</Text>
            <Text style={{ color: t.ink, fontWeight: "700" }}>{rupees(l.price * l.packs)}</Text>
          </View>
        ))}
        {min > cart.total ? <Text style={{ color: t.red, marginTop: 8 }}>Add {rupees(min - cart.total)} more: this seller's minimum is {rupees(min)}.</Text> : null}
      </Card>

      {delivery ? (
        <Card>
          <Label>Deliver to</Label>
          {addresses.map((a) => (
            <Pressable key={a.id} onPress={() => setAddr(a.id)} style={{ padding: 12, borderRadius: 12, borderWidth: 1.5, borderColor: addr === a.id ? t.brand : t.border, marginTop: 8, backgroundColor: addr === a.id ? t.brandSoft : "transparent" }}>
              <Text style={{ color: t.ink, fontWeight: "800" }}>{a.label || "Address"}</Text>
              <Text style={{ color: t.ink2, marginTop: 2 }}>{[a.flat, a.building, a.landmark, a.location_name].filter(Boolean).join(", ")}</Text>
            </Pressable>
          ))}
          {adding ? (
            <View style={{ marginTop: 8 }}>
              <TextInput placeholder="Flat / house no." placeholderTextColor={t.ink3} value={flat} onChangeText={setFlat} style={field} />
              <TextInput placeholder="Building / society" placeholderTextColor={t.ink3} value={building} onChangeText={setBuilding} style={field} />
              <TextInput placeholder="Area (e.g. Majiwada, Thane)" placeholderTextColor={t.ink3} value={area} onChangeText={setArea} style={field} />
              <Text style={{ color: t.ink3, fontSize: 12, marginTop: 6 }}>We use your phone's location to find you. Be at home when you save this.</Text>
              <Button title="Save address" onPress={saveAddress} loading={busy} disabled={!flat.trim() || !building.trim() || !area.trim()} style={{ marginTop: 10 }} />
            </View>
          ) : <Button title="+ Add a new address" kind="ghost" onPress={() => setAdding(true)} style={{ marginTop: 6 }} />}
        </Card>
      ) : null}

      {needSlot ? (
        <Card>
          <Label>Delivery time</Label>
          {days!.map((d) => (
            <View key={d.date} style={{ marginTop: 8 }}>
              <Text style={{ color: t.ink2, fontWeight: "700" }}>{d.label}</Text>
              <View style={[s.row, { flexWrap: "wrap", gap: 8, marginTop: 6 }]}>
                {d.slots.map((x) => (
                  <Pressable key={x.start} onPress={() => setSlot({ start: x.start, kind: d.kind })} style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1.5, borderColor: slot?.start === x.start ? t.brand : t.border, backgroundColor: slot?.start === x.start ? t.brandSoft : "transparent" }}>
                    <Text style={{ color: slot?.start === x.start ? t.brand : t.ink, fontWeight: "700" }}>{x.time}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
        </Card>
      ) : null}

      <Card>
        <Label>Bill</Label>
        <View style={[s.row, { justifyContent: "space-between" }]}><Text style={{ color: t.ink2 }}>Items</Text><Text style={{ color: t.ink }}>{rupees(cart.total)}</Text></View>
        {delivery ? <View style={[s.row, { justifyContent: "space-between", marginTop: 4 }]}><Text style={{ color: t.ink2 }}>Delivery</Text><Text style={{ color: t.ink }}>{rupees(fee)}</Text></View> : null}
        <View style={[s.row, { justifyContent: "space-between", marginTop: 8 }]}><Text style={[s.h2, { color: t.ink }]}>Total</Text><Text style={[s.h2, { color: t.ink }]}>{rupees(cart.total + fee)}</Text></View>
        {placement === "preorder" ? <Text style={{ color: t.purple, marginTop: 8 }}>Pre-order: delivered next day, final price set when the fish comes in.</Text> : null}
        {!!err && <Text style={{ color: t.red, marginTop: 10, fontWeight: "600" }}>{err}</Text>}
        <Button title="Place order" size="lg" onPress={place} loading={busy} disabled={!ready} style={{ marginTop: 14 }} />
        <Text style={{ color: t.ink3, fontSize: 12, textAlign: "center", marginTop: 8 }}>Next you choose: pay now, or pay in the app when it arrives.</Text>
      </Card>
    </ScrollView>
  );
}
