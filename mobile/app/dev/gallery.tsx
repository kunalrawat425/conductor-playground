/**
 * Component gallery: every web-twin component with the same sample content as public/design-system/live.html, in any of
 * the 4 modes. Dev builds only (release builds redirect home). Deep link for screenshots:
 *   relifish:///dev/gallery?c=SellerCard&theme=dark&fest=normal   (c omitted = all components)
 */
import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { ScrollView, StatusBar, View } from "react-native";
import { ThemeMode, useTheme } from "../../src/theme";
import { GALLERY } from "../../src/ui/gallery-items";
import { Text } from "../../src/ui/base";

function Page({ only }: { only?: string }) {
  const t = useTheme();
  const items = only ? GALLERY.filter((g) => g.id === only) : GALLERY;
  return (
    <ScrollView style={{ backgroundColor: t.bg2 }} contentContainerStyle={{ paddingBottom: only ? 0 : 40 }}>
      {items.map((g) => (
        <View key={g.id} testID={`ds-${g.id}`} collapsable={false}>
          {only ? null : <Text style={{ fontSize: 12, fontWeight: "700", color: t.ink3, paddingTop: 12, paddingBottom: 6, paddingHorizontal: 16 }}>{g.id} → {g.rn}</Text>}
          <View testID="ds-frame" collapsable={false} style={{ backgroundColor: t.bg2 }}>{g.render()}</View>
        </View>
      ))}
    </ScrollView>
  );
}

export default function Gallery() {
  const q = useLocalSearchParams<{ c?: string; theme?: string; fest?: string }>();
  if (!__DEV__) return <Redirect href="/" />;
  return (
    <ThemeMode.Provider value={{ dark: q.theme === "dark", festive: q.fest !== "normal" }}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar hidden />
      <Page only={q.c} />
    </ThemeMode.Provider>
  );
}
