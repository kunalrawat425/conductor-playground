/**
 * Before the OS asks (preview "Push pre-prompt"): a bottom sheet explaining what the buyer gets, shown once on the order
 * page while notifications are undecided. "Turn on updates" opens the system dialog; "Not now" doesn't ask again.
 */
import { useEffect, useState } from "react";
import { Modal, Pressable, View } from "react-native";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "./theme";
import { Button } from "./ui/atoms";
import { Text } from "./ui/base";
import { Icon, type IconName } from "./ui/icons";
import { ga } from "./track";

const KEY = "rlf_push_preprompt";
export function PushPrePrompt({ preview }: { /** gallery: always open */ preview?: boolean } = {}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [show, setShow] = useState(!!preview);
  useEffect(() => {
    if (preview || Constants.executionEnvironment === "storeClient") return;
    (async () => {
      if (await SecureStore.getItemAsync(KEY).catch(() => null)) return;
      const N = await import("expo-notifications");
      const p = await N.getPermissionsAsync();
      if (!p.granted && p.canAskAgain) setShow(true);
    })();
  }, []);
  const done = (v: string) => { setShow(false); SecureStore.setItemAsync(KEY, v).catch(() => {}); };
  async function allow() {
    done("asked"); ga("push_preprompt_allow");
    const N = await import("expo-notifications");
    if ((await N.requestPermissionsAsync()).granted) import("./push").then((m) => m.registerPush());
  }
  const rows: [IconName, string][] = [["check", "Seller confirmed your order"], ["truck", "Out for delivery, with the time"], ["card", "Pay in the app when it arrives"]];
  return (
    <Modal visible={show} transparent animationType="slide" onRequestClose={() => done("later")} statusBarTranslucent>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(15, 23, 42, 0.5)" }} onPress={() => done("later")} />
      <View style={{ backgroundColor: t.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 24, paddingHorizontal: 20, paddingBottom: insets.bottom + 16 }}>
        <View style={{ alignSelf: "center", width: 64, height: 64, borderRadius: 32, backgroundColor: t.brandL, alignItems: "center", justifyContent: "center" }}><Icon name="bell" size={28} color={t.brand} /></View>
        <Text style={{ marginTop: 14, textAlign: "center", fontSize: 21, lineHeight: 27, fontWeight: "800" }}>Know the moment your fish is on its way</Text>
        <Text style={{ marginTop: 8, textAlign: "center", fontSize: 14, lineHeight: 21, color: t.ink3 }}>We only send updates about your orders, plus fresh-catch alerts you can turn off.</Text>
        <View style={{ marginTop: 18, gap: 12 }}>{rows.map(([ic, s]) => <View key={s} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}><Icon name={ic} size={18} color={t.ink} /><Text style={{ fontSize: 14, fontWeight: "600" }}>{s}</Text></View>)}</View>
        <Button title="Turn on updates" full size="lg" onPress={allow} style={{ marginTop: 20, borderRadius: 12 }} />
        <Pressable onPress={() => { done("later"); ga("push_preprompt_later"); }} style={{ alignItems: "center", paddingVertical: 14 }}><Text style={{ fontSize: 15, fontWeight: "700", color: t.ink3 }}>Not now</Text></Pressable>
      </View>
    </Modal>
  );
}
