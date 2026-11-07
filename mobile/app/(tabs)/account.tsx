/**
 * Account (preview "Account redesign", web /me): profile card with Edit, Orders / Addresses / Help tiles, your last order
 * with Reorder, saved addresses (default, edit, add), Updates switches (notifications, WhatsApp), More (call us with
 * hours, terms, delete account), Log out, version. Same APIs as /me.
 */
import { useCallback, useState } from "react";
import { Alert, AppState, Image, Linking, Modal, Pressable, ScrollView, Switch, View } from "react-native";
import Constants from "expo-constants";
import { router, useFocusEffect } from "expo-router";
import { api, getSession, setSession, type Session } from "../../src/api";
import { resizedImageUrl } from "../../../src/lib/seller-display";
import { useTheme } from "../../src/theme";
import { ga } from "../../src/track";
import { AppHeader } from "../../src/ui/chrome";
import { Button, EmptyState, Input, SheetHeader } from "../../src/ui/atoms";
import { lh, row, Text } from "../../src/ui/base";
import { Icon, type IconName } from "../../src/ui/icons";

export default function Account() {
  const t = useTheme();
  const [me, setMe] = useState<Session | null | undefined>(undefined);
  const [profile, setProfile] = useState<any>(null);
  const [addrs, setAddrs] = useState<any[]>([]);
  const [last, setLast] = useState<any>(null);
  const [notif, setNotif] = useState(false);
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({ first_name: "", last_name: "", email: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const s = await getSession(); setMe(s);
    if (Constants.executionEnvironment !== "storeClient") import("expo-notifications").then((N) => N.getPermissionsAsync()).then((p) => setNotif(p.granted)).catch(() => {});
    if (!s) return;
    const [p, a, o] = await Promise.all([
      api(`/api/buyer/profile?buyer_id=${s.buyer_id}`).catch(() => null),
      api<{ addresses: any[] }>(`/api/buyer/addresses?buyer_id=${s.buyer_id}`).catch(() => ({ addresses: [] })),
      api<{ orders: any[] }>(`/api/buyer/orders?buyer_id=${s.buyer_id}&page=1&page_size=1`).catch(() => ({ orders: [] })),
    ]);
    const b = (p as any)?.buyer || p; setProfile(b); setForm({ first_name: b?.first_name || "", last_name: b?.last_name || "", email: b?.email || "" });
    setAddrs(a.addresses || []); setLast(o.orders?.[0] || null);
  }, []);
  useFocusEffect(useCallback(() => { load(); const sub = AppState.addEventListener("change", (x) => x === "active" && load()); return () => sub.remove(); }, [load]));

  const header = <AppHeader variant="page" title="Account" onBack={() => router.navigate("/")} />;
  if (me === null) return <View style={{ flex: 1, backgroundColor: t.bg2 }}>{header}<View style={{ marginTop: 16 }}><EmptyState icon="🔑" title="Sign in to your account" desc="Use your phone number to view profile, saved addresses, and order history." cta="Sign in" onCta={() => router.push("/login")} /></View></View>;

  const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ");
  const wa = !!profile?.whatsapp_opt_in_at && !profile?.whatsapp_opt_out_at;
  const card = { marginHorizontal: 16, backgroundColor: t.bg, borderWidth: 1, borderColor: t.border, borderRadius: 16 };
  const cap = (s: string) => <Text style={{ marginTop: 18, marginBottom: 8, marginHorizontal: 16, fontSize: 12, lineHeight: lh(12), fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase", color: t.ink3 }}>{s}</Text>;
  const listRow = (icon: IconName, label: string, onPress: () => void, right?: React.ReactNode, first?: boolean) => (
    <Pressable key={label} onPress={onPress} style={[row, { gap: 14, paddingVertical: 16, paddingHorizontal: 16, borderTopWidth: first ? 0 : 1, borderTopColor: t.border }]}>
      <Icon name={icon} size={20} color={t.ink2} />
      <Text style={{ flex: 1, fontSize: 15, fontWeight: "600" }}>{label}</Text>
      {right ?? <Icon name="chevRight" size={18} color={t.ink3} />}
    </Pressable>
  );

  async function save() {
    setBusy(true);
    try { await api("/api/buyer/profile", { buyer_id: me!.buyer_id, updates: form }); setEdit(false); await load(); }
    catch (e: any) { Alert.alert("Profile", e.message); } finally { setBusy(false); }
  }
  async function toggleNotif(on: boolean) {
    const N = await import("expo-notifications");
    if (!on) { Linking.openSettings(); return; }
    const r = await N.requestPermissionsAsync();
    if (r.granted) { setNotif(true); import("../../src/push").then((m) => m.registerPush()); } else Linking.openSettings();
  }
  async function toggleWa(on: boolean) {
    setProfile({ ...profile, whatsapp_opt_in_at: on ? new Date().toISOString() : profile?.whatsapp_opt_in_at, whatsapp_opt_out_at: on ? null : new Date().toISOString() });
    await api("/api/buyer/profile", { buyer_id: me!.buyer_id, updates: { whatsapp_updates: on } }).catch(() => load());
  }
  const lastPhoto = last?.listing?.photo_url ? resizedImageUrl(last.listing.photo_url, 120) : null;
  const lastQty = last ? (last.quantity_unit === "kg" && Number(last.quantity) < 1 ? `${Math.round(Number(last.quantity) * 1000)} g` : `${last.quantity} ${last.quantity_unit}`) : "";

  return (
    <View style={{ flex: 1, backgroundColor: t.bg2 }}>
      {header}
      <ScrollView contentContainerStyle={{ paddingTop: 14, paddingBottom: 24 }}>
        <View style={[card, row, { gap: 14, padding: 16 }]}>
          <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: t.brandL, alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 22, fontWeight: "800", color: t.brand }}>{(profile?.first_name || "R")[0].toUpperCase()}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 18, lineHeight: 22, fontWeight: "800" }}>{name || "Add your name"}</Text>
            <Text style={{ marginTop: 2, fontSize: 13, color: t.ink3 }}>+91 {String(me?.phone || "").replace(/(\d{5})(\d{5})$/, "$1 $2")}</Text>
          </View>
          <Pressable onPress={() => setEdit(true)} style={{ borderWidth: 1, borderColor: t.border, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 14 }}><Text style={{ fontSize: 13, fontWeight: "700" }}>Edit</Text></Pressable>
        </View>

        <View style={{ flexDirection: "row", gap: 10, marginHorizontal: 16, marginTop: 12 }}>
          {([["ordersO", "Orders", () => router.navigate("/orders")], ["qaPin", "Addresses", () => {}], ["help", "Help", () => Linking.openURL("tel:+919152207607")]] as [IconName, string, () => void][]).map(([ic, l, fn]) => (
            <Pressable key={l} onPress={fn} style={{ flex: 1, alignItems: "center", gap: 6, paddingVertical: 14, backgroundColor: t.bg, borderWidth: 1, borderColor: t.border, borderRadius: 14 }}><Icon name={ic} size={22} color={t.ink} /><Text style={{ fontSize: 13, fontWeight: "700" }}>{l}</Text></Pressable>
          ))}
        </View>

        {last ? (
          <View style={[card, row, { marginTop: 12, gap: 12, padding: 14 }]}>
            <View style={{ width: 44, height: 44, borderRadius: 22, overflow: "hidden", backgroundColor: t.bg3 }}>{lastPhoto ? <Image source={{ uri: lastPhoto }} style={{ width: 44, height: 44 }} /> : null}</View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 11, fontWeight: "800", letterSpacing: 0.6, color: t.ink3 }}>YOUR LAST ORDER</Text>
              <Text numberOfLines={2} style={{ marginTop: 2, fontSize: 14, fontWeight: "700", textTransform: "capitalize" }}>{last.species || last.listing?.species} {lastQty} · {last.listing?.seller?.name || "Seller"}</Text>
            </View>
            <Pressable onPress={() => { ga("reorder_clicked", { order_id: last.id }); router.push(`/order/${last.id}`); }} style={[row, { gap: 6, borderWidth: 1.5, borderColor: t.brand, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 }]}><Icon name="refresh" size={14} color={t.brand} /><Text style={{ fontSize: 13, fontWeight: "700", color: t.brand }}>Reorder</Text></Pressable>
          </View>
        ) : null}

        {cap("Saved addresses")}
        <View style={card}>
          {addrs.map((a, i) => (
            <Pressable key={a.id} onPress={() => !a.is_default && api("/api/buyer/addresses", { buyer_id: me!.buyer_id, id: a.id, address: { is_default: true } }, "PATCH").then(load).catch(() => {})}
              onLongPress={() => Alert.alert("Delete this address?", "", [{ text: "Keep" }, { text: "Delete", style: "destructive", onPress: async () => { await api("/api/buyer/addresses", { buyer_id: me!.buyer_id, id: a.id }, "DELETE").catch(() => {}); load(); } }])}
              style={[row, { gap: 14, padding: 16, borderTopWidth: i ? 1 : 0, borderTopColor: t.border }]}>
              <Icon name="homeO" size={20} color={t.ink2} />
              <View style={{ flex: 1 }}>
                <View style={[row, { gap: 8 }]}><Text style={{ fontSize: 15, fontWeight: "700" }}>{a.label || "Address"}</Text>{a.is_default ? <View style={{ backgroundColor: t.greenL, borderRadius: 6, paddingVertical: 2, paddingHorizontal: 8 }}><Text style={{ fontSize: 11, fontWeight: "700", color: t.green }}>Default</Text></View> : null}</View>
                <Text style={{ marginTop: 2, fontSize: 13, color: t.ink3 }}>{[a.flat, a.building, a.landmark, a.location_name].filter(Boolean).join(", ")}</Text>
              </View>
              <Icon name="pencil" size={18} color={t.ink3} />
            </Pressable>
          ))}
          <Pressable onPress={() => router.navigate("/")} style={[row, { gap: 14, padding: 16, borderTopWidth: addrs.length ? 1 : 0, borderTopColor: t.border }]}><Icon name="plus" size={20} color={t.brand} /><Text style={{ fontSize: 15, fontWeight: "700", color: t.brand }}>Add an address</Text></Pressable>
        </View>

        {cap("Updates")}
        <View style={card}>
          {listRow("bell", "Order updates (notifications)", () => toggleNotif(!notif), <Switch value={notif} onValueChange={toggleNotif} trackColor={{ true: t.green, false: t.bg3 }} thumbColor="#FFFFFF" />, true)}
          {listRow("msg", "WhatsApp updates", () => toggleWa(!wa), <Switch value={wa} onValueChange={toggleWa} trackColor={{ true: t.green, false: t.bg3 }} thumbColor="#FFFFFF" />)}
        </View>

        {cap("More")}
        <View style={card}>
          {listRow("phone", "Call us · 7:30 AM – 9 PM", () => Linking.openURL("tel:+919152207607"), undefined, true)}
          {listRow("file", "Terms, privacy, refunds", () => Linking.openURL("https://www.relifish.com/terms"))}
          {listRow("trash", "Delete my account", () => Linking.openURL("https://www.relifish.com/data-deletion"))}
        </View>
        <Pressable onPress={async () => { await setSession(null); load(); }} style={{ marginTop: 16, marginHorizontal: 16, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: t.border, backgroundColor: t.bg, alignItems: "center" }}><Text style={{ fontSize: 14, fontWeight: "700", color: t.red }}>Log out</Text></Pressable>
        <Text style={{ textAlign: "center", fontSize: 11, color: t.ink4, paddingTop: 12 }}>Made in Mumbai · v{Constants.expoConfig?.version}</Text>
      </ScrollView>
      <Modal visible={edit} transparent animationType="slide" onRequestClose={() => setEdit(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(15, 23, 42, 0.5)" }} onPress={() => setEdit(false)} />
        <View style={{ backgroundColor: t.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 24 }}>
          <SheetHeader title="Edit profile" onClose={() => setEdit(false)} />
          <View style={{ padding: 16, gap: 12 }}>
            <View style={{ flexDirection: "row", gap: 10 }}><View style={{ flex: 1 }}><Input label="First name" value={form.first_name} onChangeText={(v) => setForm({ ...form, first_name: v })} /></View><View style={{ flex: 1 }}><Input label="Last name" value={form.last_name} onChangeText={(v) => setForm({ ...form, last_name: v })} /></View></View>
            <Input label="Email (for order updates)" keyboardType="email-address" autoCapitalize="none" value={form.email} onChangeText={(v) => setForm({ ...form, email: v })} success={profile?.email_verified && form.email === profile?.email ? "Verified" : undefined} />
            <Button title="Save" full loading={busy} onPress={save} />
          </View>
        </View>
      </Modal>
    </View>
  );
}
