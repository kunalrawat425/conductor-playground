import { useEffect, useState } from "react";
import { Redirect, router, Tabs } from "expo-router";
import { getSession } from "../../src/api";
import { NewOrderAlarm } from "../../src/NewOrderAlarm";
import { useTheme } from "../../src/theme";
import { HeaderBackground, headerTitleStyle, Loading } from "../../src/ui";
import { BottomNav, SELLER_NAV } from "../../src/ui/chrome";

/** Relifish Partner: the website's seller bottom nav (SellerBottomNav.astro): Orders, Inventory, Profile. */
export default function PartnerLayout() {
  const t = useTheme();
  const [me, setMe] = useState<boolean | null>(null);
  useEffect(() => { getSession().then((s) => setMe(!!s?.seller_id)); }, []);
  if (me === null) return <Loading />;
  if (!me) return <Redirect href="/login" />;
  const key: Record<string, string> = { orders: "orders", inventory: "listings", profile: "account" };
  return (
    <>
    <NewOrderAlarm />
    <Tabs
      tabBar={({ state }: any) => <BottomNav items={SELLER_NAV} active={key[state.routes[state.index].name]} onPress={(k) => router.navigate(`/partner/${Object.keys(key).find((r) => key[r] === k)}` as any)} />}
      screenOptions={{
        headerBackground: () => <HeaderBackground plain />,
        headerTintColor: t.onBrand,
        headerTitleStyle,
        sceneStyle: { backgroundColor: t.page },
      }}
    >
      <Tabs.Screen name="orders" options={{ title: "Orders", headerShown: false }} />
      <Tabs.Screen name="inventory" options={{ title: "My inventory" }} />
      <Tabs.Screen name="profile" options={{ title: "My profile" }} />
    </Tabs>
    </>
  );
}
