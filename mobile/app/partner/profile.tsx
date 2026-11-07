import { useCallback, useState } from "react";
import { Alert, Linking, ScrollView, Switch, TextInput, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { api, getSession, setSession } from "../../src/api";
import { sellerPost } from "../../src/partner";
import { timeLabel } from "../../../src/lib/order-timing";
import { font, radius, useTheme } from "../../src/theme";
import { Badge, Button, Card, Label, Loading, s, Text } from "../../src/ui";
import { LocationBox } from "../../src/ui/dashboard";
import { myLocation } from "../../src/catalog";
import Constants from "expo-constants";

/** The website's /dashboard/profile, the parts a seller changes from the phone; the rest links to the site. */
export default function PartnerProfile() {
  const t = useTheme();
  const [me, setMe] = useState<any>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [locBusy, setLocBusy] = useState(false);
  const load = useCallback(async () => {
    const sess = await getSession();
    const r = await api(`/api/seller/profile?seller_id=${sess?.seller_id}`).catch((e) => { Alert.alert("Couldn't load your shop", e.message); return null; });
    if (r) setMe(r.seller);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function update(updates: Record<string, any>) {
    setMe({ ...me, ...updates });
    try { await sellerPost("/api/seller/profile", { updates }); }
    catch (e: any) { Alert.alert("Couldn't save", e.message); load(); }
  }
  if (!me) return <Loading />;

  const row = (k: string, v: string) => (
    <View style={[s.row, { justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.border }]}>
      <Text style={{ fontSize: 13, color: t.ink3 }}>{k}</Text><Text style={{ fontSize: 14, fontWeight: "600", flexShrink: 1, textAlign: "right" }}>{v}</Text>
    </View>
  );
  const toggle = (k: string, title: string, sub: string) => (
    <View style={[s.row, { justifyContent: "space-between", paddingVertical: 10, gap: 12 }]}>
      <View style={{ flex: 1 }}><Text style={{ fontSize: 14, fontWeight: "700" }}>{title}</Text><Text style={{ fontSize: 12, color: t.ink3, marginTop: 2 }}>{sub}</Text></View>
      <Switch value={!!me[k]} onValueChange={(v) => update({ [k]: v })} trackColor={{ true: t.brand, false: t.bg3 }} thumbColor={t.onBrand} />
    </View>
  );

  const field = { minHeight: 44, borderWidth: 1.5, borderColor: t.border, borderRadius: radius.sm, paddingHorizontal: 12, color: t.ink, backgroundColor: t.card, fontSize: 15, ...font(400) };
  const input = (k: string, label: string, half = false) => (
    <View style={{ flex: half ? 1 : undefined, marginTop: 12 }}>
      <Text style={{ fontSize: 13, fontWeight: "600", color: t.ink2, marginBottom: 6 }}>{label}</Text>
      <TextInput value={form[k] ?? me[k] ?? ""} onChangeText={(v) => setForm({ ...form, [k]: v })} style={field} />
    </View>
  );
  const dirty = Object.keys(form).some((k) => (form[k] ?? "") !== (me[k] ?? ""));

  return (
    <ScrollView style={{ backgroundColor: t.page }} contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
      {/* The site's /dashboard/profile form: name, location, owner contact; hours, slots, fees and photos stay on the website. */}
      <Card>
        <View style={[s.row, { gap: 6, marginBottom: 2 }]}>
          <Badge text={me.is_active ? "Live" : "Awaiting approval"} kind={me.is_active ? "green" : "amber"} />
          {me.has_delivery ? <Badge text="Delivery" kind="blue" /> : null}
          {me.has_pickup ? <Badge text="Pickup" /> : null}
        </View>
        {input("name", "Business name *")}
        <Text style={{ fontSize: 15, fontWeight: "700", marginTop: 18 }}>📍 Location</Text>
        {input("location_name", "Area / Neighborhood")}
        {input("location", "Full address / landmark")}
        <View style={{ marginTop: 12 }}>
          <LocationBox set={me.lat != null && me.lng != null} coords={me.lat != null ? `${me.location_name || ""} · ${Number(me.lat).toFixed(5)}, ${Number(me.lng).toFixed(5)}` : undefined} busy={locBusy}
            onUse={async () => { setLocBusy(true); const at = await myLocation(); if (at.fromPhone) await update({ lat: at.lat, lng: at.lng }); else Alert.alert("Location is off", "Allow location for Relifish Partner, then try again."); setLocBusy(false); }} />
        </View>
        <Text style={{ fontSize: 15, fontWeight: "700", marginTop: 18 }}>Owner contact</Text>
        <View style={[s.row, { gap: 10 }]}>{input("first_name", "First name", true)}{input("last_name", "Last name", true)}</View>
        <Text style={{ fontSize: 13, fontWeight: "600", color: t.ink2, marginTop: 12 }}>Email (for order notifications)</Text>
        <Text style={{ fontSize: 14, color: t.ink3, marginTop: 4 }} numberOfLines={1}>{me.email || "Not set"}</Text>
        <Button title="Save" onPress={async () => { await update(form); setForm({}); }} disabled={!dirty || !String(form.name ?? me.name).trim()} style={{ marginTop: 16 }} />
      </Card>
      <Card>
        <Label>Shop</Label>
        {row("Phone", me.phone ? `+91 ${String(me.phone).replace(/\D/g, "").slice(-10)}` : "—")}
        {row("Hours", me.opens_at && me.closes_at ? `${timeLabel(me.opens_at)} – ${timeLabel(me.closes_at)}` : "—")}
        {row("Delivery radius", me.delivery_rad ? `${me.delivery_rad} km` : "—")}
        {row("Minimum order", Number(me.min_order_amount) > 0 ? `₹${me.min_order_amount}` : "None")}
        {row("Closed dates", (me.closed_dates || []).length ? me.closed_dates.join(", ") : "None")}
      </Card>
      <Card>
        <Label>Orders</Label>
        {toggle("accepts_preorder", "Take pre-orders", "Buyers can order for your next delivery day.")}
        {toggle("accepts_pay_on_delivery", "Pay on delivery", "Buyers pay in the Relifish app at the door. No cash.")}
        {toggle("has_delivery", "Home delivery", "Off: pickup only.")}
      </Card>
      <View style={{ paddingHorizontal: 16, marginTop: 16, gap: 10 }}>
        <Button title="Edit hours, slots, fees and photos on the website" kind="secondary" onPress={() => Linking.openURL("https://www.relifish.com/dashboard/profile")} />
        <Button title="Call Relifish support" kind="ghost" onPress={() => Linking.openURL("tel:+919152207607") /* SUPPORT_PHONE_TEL in src/lib/brand.ts, which uses import.meta (no Hermes) */} />
        <Text style={{ textAlign: "center", fontSize: 10, color: t.ink4 }}>Relifish Partner · v{Constants.expoConfig?.version}</Text>
        <Button title="Log out" kind="danger" onPress={async () => { await setSession(null); router.replace("/login"); }} />
      </View>
    </ScrollView>
  );
}
