import { useCallback, useEffect, useState } from "react";
import { FlatList, Image, Pressable, RefreshControl, View } from "react-native";
import { router } from "expo-router";
import { loadShop, myLocation, statusText, type Listing, type Seller } from "../../src/catalog";
import { useTheme } from "../../src/theme";
import { Badge, Card, Loading, s, Text } from "../../src/ui";

export default function Home() {
  const t = useTheme();
  const [data, setData] = useState<{ sellers: Seller[]; listings: Listing[]; fromPhone: boolean } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    const at = await myLocation();
    const shop = await loadShop(at);
    setData({ ...shop, fromPhone: at.fromPhone });
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!data) return <Loading />;

  return (
    <FlatList
      style={{ backgroundColor: t.page }}
      contentContainerStyle={{ paddingBottom: 24 }}
      data={data.sellers}
      keyExtractor={(x) => x.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      ListHeaderComponent={
        <View style={{ padding: 16, paddingBottom: 4 }}>
          <Text style={[s.h1, { color: t.ink }]}>Fresh fish, near you</Text>
          <Text style={[s.body, { color: t.ink3, marginTop: 4 }]}>
            Verified sellers, cleaned and cut, delivered home.{data.fromPhone ? "" : " Showing Thane: allow location for sellers near you."}
          </Text>
        </View>
      }
      ListEmptyComponent={<Card><Text style={{ color: t.ink2 }}>No sellers deliver here yet.</Text></Card>}
      renderItem={({ item }) => {
        const st = statusText(item);
        const fish = [...new Set(data.listings.filter((l) => l.seller_id === item.id).map((l) => String(l.species)))];
        const logo = item.logo_url || item.store_image_url;
        return (
          <Pressable onPress={() => router.push(`/seller/${item.id}`)}>
            <Card big>
              <View style={s.row}>
                {logo ? <Image source={{ uri: logo }} style={{ width: 56, height: 56, borderRadius: 12, marginRight: 12 }} /> : null}
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: "700", lineHeight: 18.2 }}>{item.name}</Text>
                  <Text style={{ fontSize: 12, color: t.ink3, marginTop: 2 }}>
                    {[item.location_name, item.km != null ? `${item.km.toFixed(1)} km` : null].filter(Boolean).join(" · ")}
                  </Text>
                </View>
              </View>
              <View style={[s.row, { marginTop: 10, gap: 6, flexWrap: "wrap" }]}>
                <Badge text={st.text} kind={st.tone} />
                {item.has_delivery ? <Badge text="Delivery" kind="blue" /> : null}
              </View>
              {fish.length ? <Text style={{ fontSize: 13, color: t.ink2, marginTop: 10, textTransform: "capitalize" }} numberOfLines={2}>{fish.join(" · ")}</Text> : null}
            </Card>
          </Pressable>
        );
      }}
    />
  );
}
