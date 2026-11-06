import { useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Switch, TextInput, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { supabase } from "../../src/api";
import { packSize, sellerPost } from "../../src/partner";
import { getSpeciesDisplay } from "../../../src/lib/species";
import { font, radius, useTheme } from "../../src/theme";
import { Button, Card, Label, Loading, s, Text } from "../../src/ui";

/**
 * Partner app: edit one fish (the website's /dashboard/listings/[id]) — stock, prices, description and the
 * switches. Species, photo and pack sizes stay on the website for now; the API re-validates every field.
 */
export default function EditListing() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const [l, setL] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    supabase.from("fish_listings").select("*").eq("id", id).maybeSingle().then(({ data }) => setL(data ? { ...data, pricing_options: (data.pricing_options || []).map((o: any) => ({ ...o })) } : false));
  }, [id]);
  if (l === null) return <Loading />;
  if (!l) return <Card><Text>This fish is no longer on your menu.</Text></Card>;

  const set = (k: string, v: any) => setL({ ...l, [k]: v });
  const setOpt = (i: number, k: string, v: string) => set("pricing_options", l.pricing_options.map((o: any, j: number) => (j === i ? { ...o, [k]: v === "" ? null : Number(v.replace(/[^\d.]/g, "")) } : o)));
  const field = { minHeight: 44, borderWidth: 1.5, borderColor: t.border, borderRadius: radius.sm, paddingHorizontal: 12, color: t.ink, backgroundColor: t.card, fontSize: 15, ...font(500) };
  const unit = l.pricing_options[0]?.unit === "kg" ? "kg" : "pc";

  async function save() {
    if (l.pricing_options.some((o: any) => !(Number(o.price) >= 1))) { Alert.alert("Every pack needs a price of at least ₹1"); return; }
    setBusy(true);
    try {
      await sellerPost("/api/seller/listings", {
        action: "update", listing_id: l.id,
        updates: {
          description: l.description || null, weight_avail: Number(l.weight_avail) || 0, pricing_options: l.pricing_options,
          buyer_daily_qty_limit: l.buyer_daily_qty_limit ? Number(l.buyer_daily_qty_limit) : null,
          is_available: !!l.is_available, is_order_paused: !!l.is_order_paused, is_preorder_enabled: !!l.is_preorder_enabled,
        },
      });
      router.back();
    } catch (e: any) { Alert.alert("Couldn't save", e.message); } finally { setBusy(false); }
  }

  const toggle = (k: string, title: string, sub: string) => (
    <View style={[s.row, { justifyContent: "space-between", paddingVertical: 10, gap: 12 }]}>
      <View style={{ flex: 1 }}><Text style={{ fontSize: 14, fontWeight: "700" }}>{title}</Text><Text style={{ fontSize: 12, color: t.ink3, marginTop: 2 }}>{sub}</Text></View>
      <Switch value={!!l[k]} onValueChange={(v) => set(k, v)} trackColor={{ true: t.brand, false: t.bg3 }} thumbColor={t.onBrand} />
    </View>
  );

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: t.page }}>
      <Stack.Screen options={{ title: getSpeciesDisplay(l.species) }} />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <Card>
          <Label>Stock</Label>
          <View style={[s.row, { gap: 8 }]}>
            <TextInput value={String(l.weight_avail ?? "")} onChangeText={(v) => set("weight_avail", v.replace(/[^\d.]/g, ""))} keyboardType="numeric" style={[field, { flex: 1 }]} />
            <Text style={{ fontSize: 14, fontWeight: "700", color: t.ink2 }}>{unit} in stock</Text>
          </View>
          <Text style={{ fontSize: 12, color: t.ink3, marginTop: 6 }}>Buyers can't order more than this. 0 shows it as sold out.</Text>
        </Card>
        <Card>
          <Label>Prices</Label>
          {l.pricing_options.map((o: any, i: number) => (
            <View key={o.id || i} style={{ marginBottom: 12 }}>
              <Text style={{ fontSize: 13, fontWeight: "700", marginBottom: 6 }}>{o.label || packSize(o)}</Text>
              <View style={[s.row, { gap: 8 }]}>
                <View style={{ flex: 1 }}><Text style={{ fontSize: 11, color: t.ink3, marginBottom: 4 }}>Price ₹</Text><TextInput value={o.price == null ? "" : String(o.price)} onChangeText={(v) => setOpt(i, "price", v)} keyboardType="numeric" style={field} /></View>
                <View style={{ flex: 1 }}><Text style={{ fontSize: 11, color: t.ink3, marginBottom: 4 }}>MRP ₹ (struck, optional)</Text><TextInput value={o.compare_at_price == null ? "" : String(o.compare_at_price)} onChangeText={(v) => setOpt(i, "compare_at_price", v)} keyboardType="numeric" style={field} /></View>
              </View>
            </View>
          ))}
        </Card>
        <Card>
          <Label>Description</Label>
          <TextInput value={l.description || ""} onChangeText={(v) => set("description", v)} multiline placeholder="Where it's from, how it's cleaned" placeholderTextColor={t.ink4} style={[field, { minHeight: 80, paddingTop: 10, textAlignVertical: "top" }]} />
          <Text style={{ fontSize: 11, color: t.ink3, marginTop: 10, marginBottom: 4 }}>Max per buyer per day ({unit}, optional)</Text>
          <TextInput value={l.buyer_daily_qty_limit == null ? "" : String(l.buyer_daily_qty_limit)} onChangeText={(v) => set("buyer_daily_qty_limit", v.replace(/[^\d.]/g, "") || null)} keyboardType="numeric" style={field} />
        </Card>
        <Card>
          {toggle("is_available", "On the menu", "Off hides this fish from buyers.")}
          {toggle("is_order_paused", "Pause orders", "Stays on the menu, but buyers can't order it.")}
          {toggle("is_preorder_enabled", "Take pre-orders", "Buyers can order it for your next delivery day.")}
        </Card>
        <View style={{ paddingHorizontal: 16, marginTop: 16 }}><Button title="Save" size="lg" onPress={save} loading={busy} /></View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
