import { useCallback, useState } from "react";
import { Alert, FlatList, Image, Linking, Pressable, RefreshControl, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getSession, supabase } from "../../src/api";
import { packSize, sellerPost } from "../../src/partner";
import { getSpeciesDisplay } from "../../../src/lib/species";
import { radius, useTheme } from "../../src/theme";
import { Button, Card, Loading, s, Text } from "../../src/ui";

/** The website's /dashboard/listings: menu order, status, stock, and Edit / Pause / Delete / move. */
export default function Inventory() {
  const t = useTheme();
  const [rows, setRows] = useState<any[] | null>(null);
  const [busy, setBusy] = useState("");
  const load = useCallback(async () => {
    const me = await getSession();
    const { data, error } = await supabase.from("fish_listings").select("*").eq("seller_id", me?.seller_id).is("deleted_at", null)
      .order("sort_order", { ascending: true, nullsFirst: false }).order("created_at", { ascending: true });
    if (error) Alert.alert("Couldn't load your fish", error.message);
    setRows(data || []);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function act(key: string, body: Record<string, any>) {
    setBusy(key);
    try { await sellerPost("/api/seller/listings", body); await load(); }
    catch (e: any) { Alert.alert("Couldn't update", e.message); }
    finally { setBusy(""); }
  }

  if (!rows) return <Loading />;
  return (
    <FlatList
      style={{ backgroundColor: t.page }}
      contentContainerStyle={{ paddingBottom: 24 }}
      data={rows}
      keyExtractor={(l) => l.id}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
      ListHeaderComponent={
        <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
          {/* ponytail: new listings (species picker, photo upload) open the website's form for now. */}
          <Button title="+ Add new listing" onPress={() => Linking.openURL("https://www.relifish.com/dashboard/listings/new")} />
          <Text style={{ fontSize: 12, color: t.ink3, marginTop: 12, lineHeight: 17 }}>Use the up and down arrows to set the order buyers see on your menu.</Text>
        </View>
      }
      ListEmptyComponent={<Card><Text style={{ color: t.ink2 }}>No fish yet. Tap “+ Add fish” to list your first catch.</Text></Card>}
      renderItem={({ item: l, index }) => {
        const opts: any[] = l.pricing_options || [];
        const unit = (opts[0] || {}).unit || "piece";
        const stock = Number(l.weight_avail) || 0;
        const head = opts.reduce((m: any, o: any) => (!m || Number(o.price) < Number(m.price) ? o : m), null);
        // .v2-lc-pill / .v2-lc-chip: 11/600 pills, the dashboard's colours.
        const status: [string, string, string] = !l.is_available ? ["Paused", t.amber, t.orangeL] : l.is_order_paused ? ["Orders paused", t.amber, t.orangeL] : stock <= 0 ? ["Out of stock", t.red, t.redL] : ["Live", t.green, t.greenL];
        const pill = (text: string, fg: string, bg: string, chip = false) => (
          <View key={text} style={{ backgroundColor: chip ? t.bg2 : bg, borderRadius: 999, paddingVertical: chip ? 4 : 5, paddingHorizontal: 8, borderWidth: chip ? 1 : 0, borderColor: t.border }}>
            <Text style={{ fontSize: 11, lineHeight: 11, fontWeight: "600", color: fg }}>{text}</Text>
          </View>
        );
        const iconBtn = (name: keyof typeof Ionicons.glyphMap, label: string, onPress: () => void, color: string = t.ink2, disabled = false, border: string = t.border) => (
          <Pressable accessibilityLabel={label} disabled={disabled} onPress={onPress} style={{ flex: 1, height: 40, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: border, borderRadius: 10, backgroundColor: t.card, opacity: disabled ? 0.6 : 1 }}>
            <Ionicons name={name} size={18} color={color} /><Text style={{ fontSize: 13, fontWeight: "600", color }}>{label}</Text>
          </Pressable>
        );
        return (
          <Card style={{ padding: 0, overflow: "hidden", opacity: l.is_available ? 1 : 0.75 }}>
            <View style={[s.row, { padding: 12, gap: 12 }]}>
              <View style={{ gap: 2 }}>
                <Pressable accessibilityLabel="Move up" disabled={index === 0 || !!busy} onPress={() => act(l.id + "up", { action: "move", listing_id: l.id, direction: "up" })} style={{ opacity: index === 0 ? 0.3 : 1, padding: 2 }}><Ionicons name="chevron-up" size={18} color={t.ink3} /></Pressable>
                <Pressable accessibilityLabel="Move down" disabled={index === rows.length - 1 || !!busy} onPress={() => act(l.id + "down", { action: "move", listing_id: l.id, direction: "down" })} style={{ opacity: index === rows.length - 1 ? 0.3 : 1, padding: 2 }}><Ionicons name="chevron-down" size={18} color={t.ink3} /></Pressable>
              </View>
              <Pressable onPress={() => router.push(`/listing/${l.id}`)} style={[s.row, { flex: 1, gap: 12 }]}>
                <View style={{ width: 64, height: 64, borderRadius: radius.sm, backgroundColor: t.bg2, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
                  {l.photo_url ? <Image source={{ uri: l.photo_url }} style={{ width: 64, height: 64 }} /> : <Text style={{ fontSize: 30 }}>{(l.species || "").includes("prawn") ? "🦐" : (l.species || "").includes("crab") ? "🦀" : (l.species || "").includes("squid") ? "🦑" : "🐟"}</Text>}
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={{ fontSize: 14, fontWeight: "700" }} numberOfLines={1}>{getSpeciesDisplay(l.species)}</Text>
                  {l.size_label ? <Text style={{ fontSize: 11, color: t.ink3 }} numberOfLines={1}>{l.size_label}</Text> : null}
                  <Text style={{ fontSize: 14, fontWeight: "800" }}>{head ? `₹${Number(head.price) || 0} / ${packSize(head)}` : "No price set"}</Text>
                  <View style={[s.row, { gap: 6, flexWrap: "wrap", marginTop: 2 }]}>
                    {pill(...status)}
                    {l.is_preorder_enabled ? pill("Pre-order", t.indigo, t.indigoL) : null}
                    {pill(`${stock} ${unit === "kg" ? "kg" : "pc"} in stock`, stock <= 0 ? t.red : t.ink2, "", true)}
                    {opts.length > 1 ? pill(`${opts.length} packs`, t.ink2, "", true) : null}
                  </View>
                </View>
              </Pressable>
            </View>
            <View style={[s.row, { gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: t.border, backgroundColor: t.bg2 }]}>
              {iconBtn("create-outline", "Edit", () => router.push(`/listing/${l.id}`))}
              {iconBtn(l.is_available ? "pause" : "play", l.is_available ? "Pause" : "Resume", () => act(l.id + "toggle", { action: "update", listing_id: l.id, updates: { is_available: !l.is_available } }), l.is_available ? t.ink2 : t.amber, !!busy, l.is_available ? t.border : t.orange)}
              {iconBtn("trash-outline", "Delete", () => Alert.alert(`Delete "${getSpeciesDisplay(l.species)}"?`, "This cannot be undone.", [
                { text: "Keep", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => act(l.id + "del", { action: "delete", listing_id: l.id }) },
              ]), t.red, !!busy, t.redL)}
            </View>
          </Card>
        );
      }}
    />
  );
}
