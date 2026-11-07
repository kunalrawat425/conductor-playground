/**
 * Checkout = organisms/CheckoutSheet.astro as a bottom sheet over the seller page. Step 1 (cart review): shipment + items,
 * Diwali greeting, You might also like, preparation, bill details, delivering-to + "₹ TOTAL · Next: Delivery ›".
 * Step 2: delivery method, address, delivery time, total, ← Back / Place Order. Same order API as the site
 * (/api/orders/create-seller-cart); paying (now, or in the app on delivery) happens on the order page, like the site.
 */
import { track } from "../src/track";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Image, Linking, Pressable, ScrollView, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, getSession, supabase, type Session } from "../src/api";
import { useCart } from "../src/cart";
import { myLocation } from "../src/catalog";
import { SELLER_PUBLIC_COLUMNS } from "../../src/lib/seller-columns";
import { classifyPlacementAtOrderTime } from "../../src/lib/order-timing";
import { computeDeliveryFee, haversineKm } from "../../src/lib/order-pricing";
import { getListingPriceOptions, formatOptionMenuLabel, optionBundleAmount } from "../../src/lib/listing-pricing";
import { getSpeciesDisplay } from "../../src/lib/species";
import { compareMenuOrder } from "../../src/lib/menu-order";
import { comboParts, dealSaving, isComboListing } from "../../src/lib/combo-deals";
import { resizedImageUrl } from "../../src/lib/seller-display";
import { rupees, useFestive, useTheme } from "../src/theme";
import { AddressCard, Button, Input, SheetHeader, SlotPicker, StepBar } from "../src/ui/atoms";
import { BillDetails, CheckoutCart, CheckoutFoot, CoCard, DiwaliGiftCard, PrepPrefs, SuggestRail } from "../src/ui/checkout";
import { lh, row, Text } from "../src/ui/base";
import { pal } from "../src/theme/palette";

type Address = { id: string; label?: string; flat?: string; building?: string; landmark?: string; location_name?: string; lat?: number; lng?: number; is_default?: boolean };
type Day = { date: string; kind: "same_day" | "preorder"; label: string; slots: { start: string; end: string; time: string }[] };
const addrText = (a?: Address) => (a ? [a.flat, a.building, a.landmark, a.location_name].filter(Boolean).join(", ") : "");

export default function Checkout() {
  const t = useTheme();
  const festive = useFestive();
  const insets = useSafeAreaInsets();
  const cart = useCart();
  const [step, setStep] = useState(0);
  const [me, setMe] = useState<Session | null | undefined>(undefined);
  const [seller, setSeller] = useState<any>(null);
  const [listings, setListings] = useState<any[]>([]);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [addr, setAddr] = useState<string | null>(null);
  const [days, setDays] = useState<Day[] | null>(null);
  const [day, setDay] = useState(0);
  const [slot, setSlot] = useState<{ start: string; kind: Day["kind"] } | null>(null);
  const [method, setMethod] = useState<"delivery" | "pickup">("delivery");
  const [cut, setCut] = useState<string | undefined>();
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [flat, setFlat] = useState(""); const [building, setBuilding] = useState(""); const [area, setArea] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");

  useFocusEffect(useCallback(() => { getSession().then(setMe); }, []));
  useEffect(() => { track(step ? "checkout_step2" : "checkout_started", { seller_id: cart.seller?.id }); }, [step]); // eslint-disable-line
  useEffect(() => {
    if (!cart.seller) return;
    supabase.from("sellers").select(SELLER_PUBLIC_COLUMNS).eq("id", cart.seller.id).maybeSingle().then(({ data }: any) => { setSeller(data); if (data && !data.has_delivery) setMethod("pickup"); });
    supabase.from("fish_listings").select("*").eq("seller_id", cart.seller.id).is("deleted_at", null).then(({ data }) => setListings(((data || []) as any[]).sort(compareMenuOrder)));
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

  const placement = slot?.kind || (seller ? (classifyPlacementAtOrderTime(seller, Date.now()) as string) : "same_day");
  const pre = placement === "preorder";
  const byId = useMemo(() => Object.fromEntries(listings.map((l) => [l.id, l])), [listings]);
  // "Special deal for you!" (seller/[id].astro): the real combo with the biggest saving that can be added now and isn't in the cart.
  const deal = useMemo(() => listings.filter((l) => isComboListing(l) && !cart.lines.some((c) => c.listing_id === l.id) && (pre ? l.is_preorder_enabled : l.is_available && !l.is_order_paused))
    .flatMap((l) => (l.pricing_options || []).map((o: any, n: number) => ({ l, o, optId: o.id || `opt_${n}`, save: dealSaving(o) })))
    .filter((d) => d.save > 0).sort((a, b) => b.save - a.save)[0], [listings, cart.lines, pre]);
  // You might also like (seller/[id].astro): the first pack of other fish that can be added now, up to 6.
  const picks = useMemo(() => listings.filter((l) => l.id !== deal?.l.id && !cart.lines.some((c) => c.listing_id === l.id) && (pre ? l.is_preorder_enabled : l.is_available && !l.is_order_paused)).slice(0, 6), [listings, cart.lines, pre]);

  const close = () => (router.canGoBack() ? router.back() : router.replace("/"));
  if (!cart.seller) return <Sheet onClose={close} insets={insets.bottom}><Text style={{ padding: 24, textAlign: "center", color: t.ink2 }}>Your cart is empty.</Text></Sheet>;
  if (me === null) return (
    <Sheet onClose={close} insets={insets.bottom}>
      <View style={{ padding: 20, gap: 10 }}>
        <Text style={{ fontSize: 17, fontWeight: "800", textAlign: "center" }}>Log in to order</Text>
        <Text style={{ color: t.ink3, textAlign: "center" }}>Your cart stays as it is.</Text>
        <Button title="Log in with your number" full onPress={() => router.push("/login")} />
      </View>
    </Sheet>
  );

  const delivery = method === "delivery";
  const chosen = addresses.find((a) => a.id === addr);
  const km = chosen?.lat != null && seller?.lat != null ? haversineKm(Number(seller.lat), Number(seller.lng), Number(chosen.lat), Number(chosen.lng)) : undefined;
  const fee = seller ? computeDeliveryFee(seller, cart.total, delivery ? "delivery" : "pickup", km) : 0;
  const min = Number(seller?.min_order_amount) || 0;
  const freeAbove = Number(seller?.free_delivery_above) || 0;
  const mrp = cart.lines.reduce((n, l) => { const o = getListingPriceOptions(byId[l.listing_id] || {}).find((x: any, i: number) => (x.id || `opt_${i}`) === l.option_id) as any; return n + (Number(o?.compare_at_price) > l.price ? Number(o.compare_at_price) : l.price) * l.packs; }, 0);
  const saved = Math.max(0, mrp - cart.total);
  const needSlot = delivery && !!days?.length;
  const ready = !!seller && (!delivery || !!addr) && (!needSlot || !!slot) && cart.total >= min && placement !== "closed";
  const firstDay = days?.[0];
  const when = pre ? `Pre-order · ${firstDay?.label || "next day"}` : "Today";

  async function saveAddress() {
    setBusy(true); setErr("");
    try {
      const at = await myLocation();
      const r = await api<{ address: Address }>("/api/buyer/addresses", { buyer_id: me!.buyer_id, address: { label: "Home", flat, building, location_name: area, lat: at.fromPhone ? at.lat : null, lng: at.fromPhone ? at.lng : null, is_default: !addresses.length } });
      setAddresses((a) => [...a, r.address]); setAddr(r.address.id); setAdding(false);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function place() {
    setBusy(true); setErr(""); track("place_order_tap", { seller_id: cart.seller?.id });
    try {
      const r = await api<{ orders: { id: string }[] }>("/api/orders/create-seller-cart", {
        seller_id: cart.seller!.id,
        lines: cart.lines.map((l) => ({ listing_id: l.listing_id, quantity: Math.round(l.bundle * l.packs * 1000) / 1000, quantity_unit: l.unit, pricing_option_id: l.option_id })),
        buyer_phone: me!.phone, buyer_id: me!.buyer_id, buyer_addr: delivery ? addr : null,
        order_type: delivery ? "delivery" : "pickup", delivery_slot_start: needSlot ? slot!.start : null, placement_kind: placement,
        ...(cut ? { cut_style: cut } : {}), ...(note.trim() ? { buyer_notes: note.trim() } : {}),
        utm: { utm_source: "app", utm_medium: "android" },
      });
      track("order_created", { seller_id: cart.seller?.id, meta: { order_id: r.orders[0].id } });
      cart.clear();
      router.replace(`/order/${r.orders[0].id}`);
    } catch (e: any) { setErr(e.message); track("order_failed", { seller_id: cart.seller?.id, meta: { error: String(e.message).slice(0, 120) } }); } finally { setBusy(false); }
  }
  const setQty = (i: number, d: 1 | -1) => { const l = cart.lines[i]; cart.setPacks(cart.seller!, l, l.packs + d); };
  const addPick = (i: number) => {
    const l = picks[i]; const o: any = getListingPriceOptions(l)[0]; if (!o) return;
    const price = pre ? Number(o.preorder_price_max) || Number(o.preorder_price_min) || Number(o.price) || 0 : Number(o.price) || 0;
    cart.setPacks(cart.seller!, { listing_id: l.id, species: l.species, option_id: o.id || "opt_0", option_label: o.label || formatOptionMenuLabel(o), unit: o.unit || "kg", bundle: optionBundleAmount(o), price }, 1);
  };

  return (
    <Sheet onClose={close} insets={0}>
      <View style={{ paddingTop: 16, paddingBottom: 16 }}><StepBar step={step} /></View>
      {step === 0 ? (
        <>
          <ScrollView style={{ flexGrow: 0, maxHeight: 520 }} contentContainerStyle={{ gap: 12, paddingBottom: 12 }}>
            <CheckoutCart when={when} shipment={`Shipment of ${cart.lines.length} item${cart.lines.length !== 1 ? "s" : ""} from ${cart.seller.name}`} onPickTime={() => setStep(1)} onClear={() => { cart.clear(); close(); }} onQty={setQty}
              items={cart.lines.map((l) => { const L = byId[l.listing_id]; const o: any = getListingPriceOptions(L || {}).find((x: any, i: number) => (x.id || `opt_${i}`) === l.option_id); return { photo: L?.photo_url ? resizedImageUrl(L.photo_url, 300) : null, name: getSpeciesDisplay(l.species), sub: `${l.packs} pack · ${l.option_label}`, qty: l.packs, price: rupees(l.price * l.packs), was: Number(o?.compare_at_price) > l.price ? rupees(Number(o.compare_at_price) * l.packs) : null }; })} />
            {deal ? (
              <CoCard title="Special deal for you!">
                <View style={[row, { gap: 12 }]}>
                  {deal.l.photo_url ? <Image source={{ uri: resizedImageUrl(deal.l.photo_url, 300)! }} style={{ width: 56, height: 56, borderRadius: 10 }} /> : null}
                  <Text style={{ flex: 1, fontSize: 14, lineHeight: 20 }}>Upgrade to {getSpeciesDisplay(deal.l.species)}{"\n"}<Text style={{ fontWeight: "800" }}>{rupees(Number(deal.o.price))}</Text>  <Text style={{ color: t.ink4, textDecorationLine: "line-through" }}>{rupees(Number(deal.o.compare_at_price))}</Text></Text>
                  <Pressable onPress={() => { const o: any = deal.o; cart.setPacks(cart.seller!, { listing_id: deal.l.id, species: deal.l.species, option_id: deal.optId, option_label: "pack", unit: o.unit || "kg", bundle: optionBundleAmount(o), price: pre ? Number(o.preorder_price_max) || Number(o.preorder_price_min) || Number(o.price) || 0 : Number(o.price) || 0 }, 1); }}
                    style={{ width: 64, height: 36, borderRadius: 9, borderWidth: 1, borderColor: t.brand, alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 13, fontWeight: "800", color: t.brand }}>ADD</Text></Pressable>
                </View>
                <Text style={{ marginTop: 10, fontSize: 13, fontWeight: "700", color: t.green }}>{comboParts(deal.o.label).length > 1 ? `${comboParts(deal.o.label).join(" + ")}: save` : "Save"} {rupees(deal.save)} on this combo</Text>
              </CoCard>
            ) : null}
            {festive ? <DiwaliGiftCard onOpen={() => Linking.openURL("https://www.relifish.com/diwali-wishes")} /> : null}
            {picks.length ? <SuggestRail onAdd={addPick} items={picks.map((l) => { const o: any = getListingPriceOptions(l)[0] || {}; return { photo: l.photo_url ? resizedImageUrl(l.photo_url, 300) : null, price: rupees(Number(o.price) || 0), was: Number(o.compare_at_price) > Number(o.price) ? rupees(Number(o.compare_at_price)) : null, name: getSpeciesDisplay(l.species), size: o.label || o.unit_label || "" }; })} /> : null}
            <PrepPrefs options={["Whole", "Cleaned", "Cut"]} value={cut} onChange={(v) => setCut((c) => (c === v ? undefined : v))} note={note} onNote={setNote} />
            <BillDetails toPay={rupees(cart.total + fee)} savings={saved ? rupees(saved) : null}
              rows={[{ k: "Items total", v: rupees(cart.total), was: saved ? rupees(mrp) : null, saved: saved ? `Saved ${rupees(saved)}` : null },
                ...(delivery ? [{ k: "Delivery charge", v: fee ? rupees(fee) : "FREE", hint: freeAbove && cart.total < freeAbove ? `Shop for ${rupees(freeAbove - cart.total)} more to get FREE delivery` : null }] : [])]} />
            {min > cart.total ? <Text style={{ marginHorizontal: 16, fontSize: 12, fontWeight: "600", color: t.orange }}>Add {rupees(min - cart.total)} more: this seller's minimum is {rupees(min)}.</Text> : null}
          </ScrollView>
          <CheckoutFoot to={delivery ? `Delivering to ${chosen?.label || "Home"}` : "Pickup from the shop"} address={delivery ? addrText(chosen) || "Add an address" : cart.seller.name} total={rupees(cart.total + fee)} cta="Next: Delivery ›" disabled={cart.total < min} onChange={() => setStep(1)} onPay={() => setStep(1)} safeBottom={insets.bottom} />
        </>
      ) : (
        <ScrollView style={{ flexGrow: 0, maxHeight: 640 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 16, gap: 10 }}>
          <Text style={{ fontSize: 14, lineHeight: lh(14), fontWeight: "800" }}>Delivery method</Text>
          <View style={{ gap: 8 }}>
            {seller?.has_delivery ? <MethodOpt on={delivery} title="Delivery" desc="To your address · Fee applies" onPress={() => setMethod("delivery")} /> : null}
            <MethodOpt on={!delivery} title="Pickup" desc="Collect from the shop · No delivery fee" onPress={() => setMethod("pickup")} />
          </View>
          {!seller?.has_delivery ? <Text style={{ textAlign: "center", fontSize: 11, color: t.ink3 }}>This shop offers pickup only.</Text> : null}
          {delivery ? (
            <>
              <Text style={{ marginTop: 6, fontSize: 14, fontWeight: "800" }}>Deliver to</Text>
              {addresses.map((a) => <AddressCard key={a.id} label={a.label || "Address"} type={/office|work/i.test(a.label || "") ? "office" : "home"} text={addrText(a)} isDefault={a.is_default} selected={addr === a.id} onPress={() => setAddr(a.id)} />)}
              {adding ? (
                <View style={{ gap: 10 }}>
                  <Input placeholder="Flat / house no." value={flat} onChangeText={setFlat} />
                  <Input placeholder="Building / society" value={building} onChangeText={setBuilding} />
                  <Input placeholder="Area (e.g. Majiwada, Thane)" value={area} onChangeText={setArea} helper="We use your phone's location to find you. Be at home when you save this." />
                  <Button title="Save address" full loading={busy} disabled={!flat.trim() || !building.trim() || !area.trim()} onPress={saveAddress} />
                </View>
              ) : <Button title="+ Add a new address" variant="ghost" full onPress={() => setAdding(true)} />}
              {needSlot ? (
                <>
                  <Text style={{ marginTop: 6, fontSize: 14, fontWeight: "800" }}>When do you want it?</Text>
                  <View style={[row, { gap: 6, flexWrap: "wrap" }]}>{days!.map((d, i) => <Pressable key={d.date} onPress={() => setDay(i)} style={{ paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: day === i ? t.brand : t.border, backgroundColor: day === i ? t.brand : t.bg }}><Text style={{ fontSize: 12, fontWeight: "600", color: day === i ? pal.white : t.ink2 }}>{d.label}</Text></Pressable>)}</View>
                  <SlotPicker slots={(days![day]?.slots || []).map((x) => ({ id: x.start, time: x.time }))} selected={slot?.start} onPick={(sid) => setSlot({ start: sid, kind: days![day].kind })} />
                  <Text style={{ fontSize: 12, color: t.ink3 }}>We aim for this time and will let you know if it changes.</Text>
                </>
              ) : null}
            </>
          ) : null}
          <View style={[row, { justifyContent: "space-between", marginTop: 6, paddingTop: 8, borderTopWidth: 1, borderStyle: "dashed", borderTopColor: t.ink4 }]}><Text style={{ fontSize: 16, fontWeight: "800" }}>Total</Text><Text style={{ fontSize: 16, fontWeight: "800" }}>{rupees(cart.total + fee)}</Text></View>
          {pre ? <Text style={{ fontSize: 12, color: t.purple }}>Pre-order: delivered on your chosen day; the final price is set when the fish comes in.</Text> : null}
          {err ? <Text style={{ fontSize: 13, fontWeight: "600", color: t.red }}>{err}</Text> : null}
          <View style={[row, { gap: 8, marginTop: 6 }]}>
            <Button title="← Back" variant="ghost" style={{ flex: 1 }} onPress={() => setStep(0)} />
            <Button title="Place Order" style={{ flex: 1 }} loading={busy} disabled={!ready} onPress={place} />
          </View>
          <Text style={{ textAlign: "center", fontSize: 10, color: t.ink4 }}>Secure payment · Full refund if your order can't be fulfilled</Text>
        </ScrollView>
      )}
    </Sheet>
  );
}

function MethodOpt({ on, title, desc, onPress }: { on: boolean; title: string; desc: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} style={[row, { gap: 12, padding: 14, borderRadius: 12, borderWidth: 1.5, borderColor: on ? t.brand : t.border, backgroundColor: on ? t.brandL : t.bg }]}>
      <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: on ? t.brand : t.ink4, alignItems: "center", justifyContent: "center" }}>{on ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.brand }} /> : null}</View>
      <View><Text style={{ fontSize: 14, fontWeight: "700" }}>{title}</Text><Text style={{ marginTop: 2, fontSize: 12, color: t.ink3 }}>{desc}</Text></View>
    </Pressable>
  );
}

/** The site's bottom sheet: dimmed page behind, 20 px rounded top, handle + title + ×. */
function Sheet({ children, onClose, insets }: { children: React.ReactNode; onClose: () => void; insets: number }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, justifyContent: "flex-end" }}>
      <Pressable style={{ position: "absolute", inset: 0, backgroundColor: pal.a15_23_42_05 } as any} onPress={onClose} />
      <View style={{ backgroundColor: t.bg2, borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: "hidden", maxHeight: "92%", paddingBottom: insets }}>
        <View style={{ backgroundColor: t.bg }}><SheetHeader title="Checkout" onClose={onClose} /></View>
        {children}
      </View>
    </View>
  );
}
