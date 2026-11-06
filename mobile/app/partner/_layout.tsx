import { useEffect, useState } from "react";
import { Redirect, Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getSession } from "../../src/api";
import { NewOrderAlarm } from "../../src/NewOrderAlarm";
import { useTheme } from "../../src/theme";
import { HeaderBackground, headerTitleStyle, Loading, Text } from "../../src/ui";

/** Relifish Partner: the website's seller bottom nav (SellerBottomNav.astro): Orders, Inventory, Profile. */
export default function PartnerLayout() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [me, setMe] = useState<boolean | null>(null);
  useEffect(() => { getSession().then((s) => setMe(!!s?.seller_id)); }, []);
  if (me === null) return <Loading />;
  if (!me) return <Redirect href="/login" />;
  const icon = (name: keyof typeof Ionicons.glyphMap) => ({ color }: { color: any }) => <Ionicons name={name} color={color} size={22} />;
  const label = (text: string) => ({ focused, color }: { focused: boolean; color: any }) => <Text style={{ fontSize: 12, lineHeight: 12, letterSpacing: 0.12, color, fontWeight: focused ? "700" : "500" }}>{text}</Text>;
  return (
    <>
    <NewOrderAlarm />
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: t.brand,
        tabBarInactiveTintColor: t.ink4,
        tabBarStyle: { height: 64 + insets.bottom, paddingTop: 8, backgroundColor: t.card, borderTopColor: t.border, borderTopWidth: 1, elevation: 8 },
        headerBackground: () => <HeaderBackground plain />,
        headerTintColor: t.onBrand,
        headerTitleStyle,
        sceneStyle: { backgroundColor: t.page },
      }}
    >
      <Tabs.Screen name="orders" options={{ title: "Orders", headerShown: false, tabBarLabel: label("Orders"), tabBarIcon: icon("receipt") }} />
      <Tabs.Screen name="inventory" options={{ title: "My inventory", tabBarLabel: label("Inventory"), tabBarIcon: icon("fish") }} />
      <Tabs.Screen name="profile" options={{ title: "My profile", tabBarLabel: label("Profile"), tabBarIcon: icon("storefront") }} />
    </Tabs>
    </>
  );
}
