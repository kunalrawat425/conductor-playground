import { useCallback, useState } from "react";
import { Alert, FlatList, Linking, RefreshControl, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { getSession, supabase } from "../../src/api";
import { packSize, sellerPost } from "../../src/partner";
import { getSpeciesDisplay } from "../../../src/lib/species";
import { useTheme } from "../../src/theme";
import { Button, Card, Loading, Text } from "../../src/ui";
import { ListingCard } from "../../src/ui/dashboard";

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
          <Text style={{ fontSize: 12, color: t.ink3, marginTop: 12, marginBottom: 12, lineHeight: 17 }}>Use the up and down arrows to set the order buyers see on your menu.</Text>
        </View>
      }
      ListEmptyComponent={<Card><Text style={{ color: t.ink2 }}>No fish yet. Tap “+ Add fish” to list your first catch.</Text></Card>}
      renderItem={({ item: l, index }) => {
        const opts: any[] = l.pricing_options || [];
        const unit = (opts[0] || {}).unit || "piece";
        const stock = Number(l.weight_avail) || 0;
        const head = opts.reduce((m: any, o: any) => (!m || Number(o.price) < Number(m.price) ? o : m), null);
        const chips = [!l.is_available ? "Paused" : l.is_order_paused ? "Orders paused" : stock <= 0 ? "Out of stock" : "", `${stock} ${unit === "kg" ? "kg" : "pc"} in stock`, opts.length > 1 ? `${opts.length} packs` : ""].filter(Boolean);
        return (
          <View style={{ marginBottom: 12, opacity: busy.startsWith(l.id) ? 0.6 : 1 }}>
            <ListingCard photo={l.photo_url} name={getSpeciesDisplay(l.species)} note={l.size_label || l.description}
              price={head ? `₹${Number(head.price) || 0} / ${packSize(head)}` : "No price set"} live={!!l.is_available && !l.is_order_paused && stock > 0} preorder={!!l.is_preorder_enabled} chips={chips}
              upDisabled={index === 0 || !!busy} downDisabled={index === rows.length - 1 || !!busy}
              onUp={() => act(l.id + "up", { action: "move", listing_id: l.id, direction: "up" })} onDown={() => act(l.id + "down", { action: "move", listing_id: l.id, direction: "down" })}
              onPress={() => router.push(`/listing/${l.id}`)} onEdit={() => router.push(`/listing/${l.id}`)} paused={!l.is_available}
              onPause={() => act(l.id + "toggle", { action: "update", listing_id: l.id, updates: { is_available: !l.is_available } })}
              onDelete={() => Alert.alert(`Delete "${getSpeciesDisplay(l.species)}"?`, "This cannot be undone.", [{ text: "Keep", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => act(l.id + "del", { action: "delete", listing_id: l.id }) }])} />
          </View>
        );
      }}
    />
  );
}
