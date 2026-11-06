import { Redirect, Tabs } from "expo-router";
import { VARIANT } from "../../src/api";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFestive, useTheme } from "../../src/theme";
import { HeaderBackground, headerTitleStyle, logoColor, Text } from "../../src/ui";

/** Bottom nav like the site's .v2-bottom-nav: 64 px, white, 1 px top border, labels 12 px Inter 700 active / 500 idle. */
export default function TabsLayout() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const festiveOn = useFestive(); // re-render the header when /api/theme answers
  if (VARIANT === "partner") return <Redirect href="/partner/orders" />;
  const icon = (name: keyof typeof Ionicons.glyphMap) => ({ color }: { color: any }) => <Ionicons name={name} color={color} size={22} />;
  const label = (text: string) => ({ focused, color }: { focused: boolean; color: any }) => <Text style={{ fontSize: 12, lineHeight: 12, letterSpacing: 0.12, color, fontWeight: focused ? "700" : "500" }}>{text}</Text>;
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: t.brand,
        tabBarInactiveTintColor: t.ink4,
        tabBarStyle: { height: 64 + insets.bottom, paddingTop: 8, backgroundColor: t.card, borderTopColor: t.border, borderTopWidth: 1, elevation: 8, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 16, shadowOffset: { width: 0, height: -4 } },
        headerBackground: () => <HeaderBackground />,
        headerTintColor: t.onBrand,
        headerTitleStyle,
        sceneStyle: { backgroundColor: t.page },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Relifish", tabBarLabel: label("Home"), tabBarIcon: icon("home"), headerTitleStyle: { ...headerTitleStyle, color: logoColor(festiveOn) } }} />
      <Tabs.Screen name="orders" options={{ title: "Your orders", tabBarLabel: label("Orders"), tabBarIcon: icon("receipt") }} />
      <Tabs.Screen name="account" options={{ title: "Account", tabBarLabel: label("Account"), tabBarIcon: icon("person") }} />
    </Tabs>
  );
}
