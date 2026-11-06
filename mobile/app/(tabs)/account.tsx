import { useCallback, useState } from "react";
import { Linking, ScrollView } from "react-native";
import { router, useFocusEffect } from "expo-router";
import Constants from "expo-constants";
import { getSession, setSession, type Session } from "../../src/api";
import { useTheme } from "../../src/theme";
import { Button, Card, Label, s, Text } from "../../src/ui";

export default function Account() {
  const t = useTheme();
  const [me, setMe] = useState<Session | null>(null);
  useFocusEffect(useCallback(() => { getSession().then(setMe); }, []));
  const open = (path: string) => Linking.openURL(`https://www.relifish.com${path}`);
  return (
    <ScrollView style={{ backgroundColor: t.page }} contentContainerStyle={{ paddingBottom: 40 }}>
      <Card>
        <Label>You</Label>
        {me ? <Text style={[s.h2, { color: t.ink }]}>+91 {me.phone}</Text> : <Text style={{ color: t.ink2 }}>Not logged in</Text>}
        {me
          ? <Button title="Log out" kind="danger" onPress={async () => { await setSession(null); setMe(null); }} style={{ marginTop: 12 }} />
          : <Button title="Log in" onPress={() => router.push("/login")} style={{ marginTop: 12 }} />}
      </Card>
      <Card>
        <Label>Help</Label>
        <Text style={{ color: t.ink2 }}>A real person answers, 7:30 AM – 9 PM.</Text>
        <Button title="📞 Call +91 91522 07607" kind="secondary" onPress={() => Linking.openURL("tel:+919152207607")} style={{ marginTop: 10 }} />
        <Button title="WhatsApp us" kind="ghost" onPress={() => Linking.openURL("https://wa.me/919152207607")} style={{ marginTop: 6 }} />
      </Card>
      <Card>
        <Label>About</Label>
        <Button title="Privacy policy" kind="ghost" onPress={() => open("/privacy")} />
        <Button title="Terms" kind="ghost" onPress={() => open("/terms")} />
        <Button title="Refund policy" kind="ghost" onPress={() => open("/refund-policy")} />
        <Button title="Delete my account" kind="ghost" onPress={() => open("/data-deletion")} />
        <Text style={{ color: t.ink3, textAlign: "center", marginTop: 8, fontSize: 12 }}>Relifish {Constants.expoConfig?.version}</Text>
      </Card>
    </ScrollView>
  );
}
