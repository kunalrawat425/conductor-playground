import { useEffect } from "react";
import Constants from "expo-constants";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold, Inter_900Black } from "@expo-google-fonts/inter";
import { VARIANT } from "../src/api";
import { CartProvider } from "../src/cart";
import { useTheme } from "../src/theme";
import { HeaderBackground, headerTitleStyle, Loading } from "../src/ui";

export default function Root() {
  const t = useTheme();
  // Inter, like the site; render nothing styled until it's loaded (a missing font family crashes some Android builds).
  const [loaded, error] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold, Inter_900Black });
  // Push: real builds only (Expo Go dropped remote push on Android), loaded lazily so Expo Go never imports it.
  useEffect(() => {
    if (Constants.executionEnvironment === "storeClient") return;
    let sub: { remove(): void } | undefined;
    import("../src/push").then((p) => { p.registerPush(); sub = p.onPushTap(); });
    return () => sub?.remove();
  }, []);
  if (!loaded && !error) return <Loading />;
  return (
    <SafeAreaProvider>
      <CartProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerBackground: () => <HeaderBackground plain={VARIANT === "partner"} />,
            headerTintColor: t.onBrand,
            headerTitleStyle,
            contentStyle: { backgroundColor: t.page },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="partner" options={{ headerShown: false }} />
          <Stack.Screen name="listing/[id]" options={{ title: "Edit fish" }} />
          <Stack.Screen name="seller/[id]" options={{ title: "" }} />
          <Stack.Screen name="checkout" options={{ title: "Checkout" }} />
          <Stack.Screen name="order/[id]" options={{ title: "Order details" }} />
          <Stack.Screen name="login" options={{ title: VARIANT === "partner" ? "Relifish Partner" : "Log in", presentation: VARIANT === "partner" ? "card" : "modal", headerBackVisible: VARIANT !== "partner" }} />
        </Stack>
      </CartProvider>
    </SafeAreaProvider>
  );
}
