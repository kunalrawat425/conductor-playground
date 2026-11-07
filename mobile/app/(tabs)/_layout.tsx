import { Redirect, router, Tabs } from "expo-router";
import { VARIANT } from "../../src/api";
import { useTheme } from "../../src/theme";
import { BottomNav, BUYER_NAV } from "../../src/ui/chrome";

/** Buyer tabs with the site's bottom nav (organisms/BottomNav.astro); each screen draws its own AppHeader. */
export default function TabsLayout() {
  const t = useTheme();
  if (VARIANT === "partner") return <Redirect href="/partner/orders" />;
  const key = { index: "home", orders: "orders", account: "account" } as Record<string, string>;
  return (
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: t.bg2 } }}
      tabBar={({ state }: any) => (
        <BottomNav items={BUYER_NAV} active={key[state.routes[state.index].name]} onPress={(k) => router.navigate(k === "home" ? "/" : (`/${k}` as any))} />
      )}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="orders" />
      <Tabs.Screen name="account" />
    </Tabs>
  );
}
