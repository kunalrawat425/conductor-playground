/**
 * Account = the site's /me (src/pages/me.astro): page header, profile hero (name / Welcome, phone, Edit profile), quick tiles
 * (Addresses, Orders, Alerts, Call us), add-email prompt, Saved Addresses (default / delete / add), Order History
 * (Active / Past), Preferences (theme), Terms & Privacy, Log out, version. Same APIs (/api/buyer/profile, addresses, orders).
 * App-only: "Delete my account" (store policy) and the app version.
 */
import { useCallback, useState } from "react";
import { Alert, Linking, Modal, Pressable, ScrollView, View } from "react-native";
import Constants from "expo-constants";
import { router, useFocusEffect } from "expo-router";
import { api, getSession, setSession, type Session } from "../../src/api";
import { setThemePref, useIsDark, useTheme } from "../../src/theme";
import { AppHeader } from "../../src/ui/chrome";
import { EmailPrompt, MeSectionHead, OrderHistoryRow, ProfileHero, QuickTiles, SavedAddress } from "../../src/ui/account";
import { Button, EmptyState, Input, SheetHeader } from "../../src/ui/atoms";
import { Text } from "../../src/ui/base";

const ACTIVE = new Set(["pending", "pending_payment", "payment_required", "pre_order", "scheduled", "confirmed", "paid", "ready_for_pickup", "out_for_delivery"]);
const ST: Record<string, [string, "red" | "green" | "amber" | "brand"]> = { cancelled: ["Cancelled", "red"], declined: ["Declined", "red"], refunded: ["Refunded", "red"], completed: ["Delivered", "green"], picked_up: ["Picked up", "green"] };
const when = (iso: string) => { const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000); return d === 0 ? "Today" : d === 1 ? "Yesterday" : new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" }); };

export default function Account() {
  const t = useTheme();
  const dark = useIsDark();
  const [me, setMe] = useState<Session | null | undefined>(undefined);
  const [profile, setProfile] = useState<any>(null);
  const [addrs, setAddrs] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({ first_name: "", last_name: "", email: "" });
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const s = await getSession(); setMe(s);
    if (!s) return;
    const [p, a, o] = await Promise.all([
      api(`/api/buyer/profile?buyer_id=${s.buyer_id}`).catch(() => null),
      api<{ addresses: any[] }>(`/api/buyer/addresses?buyer_id=${s.buyer_id}`).catch(() => ({ addresses: [] })),
      api<{ orders: any[] }>(`/api/buyer/orders?buyer_id=${s.buyer_id}&page=1&page_size=5`).catch(() => ({ orders: [] })),
    ]);
    const b = (p as any)?.buyer || p; setProfile(b); setForm({ first_name: b?.first_name || "", last_name: b?.last_name || "", email: b?.email || "" });
    setAddrs(a.addresses || []); setOrders(o.orders || []);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const header = <AppHeader variant="page" title="Account" onBack={() => router.navigate("/")} />;
  if (me === null) return <View style={{ flex: 1, backgroundColor: t.bg2 }}>{header}<View style={{ marginTop: 16 }}><EmptyState icon="🔑" title="Sign in to your account" desc="Use your phone number to view profile, saved addresses, and order history." cta="Sign in" onCta={() => router.push("/login")} /></View></View>;

  const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || "Welcome";
  const active = orders.filter((o) => ACTIVE.has(o.status)), past = orders.filter((o) => !ACTIVE.has(o.status));
  const row = (o: any) => { const [label, tone] = ST[o.status] || [o.status.replace(/_/g, " "), "brand"]; return <OrderHistoryRow key={o.id} seller={o.listing?.seller?.name || "Seller"} line={`${when(o.created_at)} · ${o.quantity}${o.quantity_unit === "kg" ? "kg" : " " + o.quantity_unit} ${o.species || o.listing?.species || ""}`} status={label.charAt(0).toUpperCase() + label.slice(1)} statusTone={tone} total={`₹${Number(o.total_price || 0).toLocaleString("en-IN")}`} onPress={() => router.push(`/order/${o.id}`)} />; };
  const cap = (s: string) => <Text style={{ marginTop: 4, marginBottom: 8, marginHorizontal: 16, fontSize: 12, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", color: t.ink3 }}>{s}</Text>;

  async function save() {
    setBusy(true);
    try { await api("/api/buyer/profile", { buyer_id: me!.buyer_id, updates: form }); setEdit(false); await load(); }
    catch (e: any) { Alert.alert("Profile", e.message); } finally { setBusy(false); }
  }
  async function verifyEmail() {
    try { await api("/api/auth/verify-email", { role: "buyer", id: me!.buyer_id, email: form.email }); Alert.alert("Check your email", "We sent you a verification link."); }
    catch (e: any) { Alert.alert("Email", e.message); }
  }
  return (
    <View style={{ flex: 1, backgroundColor: t.bg2 }}>
      {header}
      <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
        <ProfileHero name={name} phone={me?.phone || ""} onEdit={() => setEdit(true)} />
        <QuickTiles items={[{ icon: "qaPin", label: "Addresses" }, { icon: "qaOrders", label: "Orders", onPress: () => router.navigate("/orders") }, { icon: "qaBell", label: "Alerts", onPress: () => Linking.openSettings() }, { icon: "qaPhone", label: "Call us", onPress: () => Linking.openURL("tel:+919152207607") }]} />
        {!profile?.email_verified ? <View style={{ marginTop: 12 }}><EmailPrompt onAdd={() => setEdit(true)} /></View> : null}
        <MeSectionHead title="Saved Addresses" />
        <View style={{ gap: 8 }}>
          {addrs.map((a) => <SavedAddress key={a.id} label={a.label || "Address"} isDefault={a.is_default} text={[a.flat, a.building, a.landmark, a.location_name].filter(Boolean).join(", ")}
            onDelete={() => Alert.alert("Delete this address?", "", [{ text: "Keep" }, { text: "Delete", style: "destructive", onPress: async () => { await api("/api/buyer/addresses", { buyer_id: me!.buyer_id, id: a.id }, "DELETE").catch(() => {}); load(); } }])}
            onPress={() => !a.is_default && api("/api/buyer/addresses", { buyer_id: me!.buyer_id, id: a.id, address: { is_default: true } }, "PATCH").then(load).catch(() => {})} />)}
          <View style={{ marginHorizontal: 16, marginTop: 8 }}><Button title="+ Add new address" variant="secondary" full onPress={() => router.navigate("/")} /></View>
        </View>
        <MeSectionHead title="Order History" />
        {active.length ? <>{cap(`Active (${active.length})`)}<View style={{ gap: 8 }}>{active.map(row)}</View></> : null}
        {past.length ? <>{cap(`Past (${past.length})`)}<View style={{ gap: 8 }}>{past.map(row)}</View></> : null}
        {!orders.length && me ? <Text style={{ marginHorizontal: 16, color: t.ink3 }}>No orders yet.</Text> : null}
        <MeSectionHead title="Preferences" />
        <Pressable onPress={() => setThemePref(dark ? "light" : "dark")} style={{ marginHorizontal: 16, marginBottom: 16, flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: t.border, backgroundColor: t.bg }}>
          <Text style={{ fontSize: 22 }}>{dark ? "🌙" : "☀️"}</Text><Text style={{ flex: 1, fontSize: 14, fontWeight: "600" }}>{dark ? "Dark mode" : "Light mode"}</Text><Text style={{ color: t.ink3, fontSize: 12 }}>Tap to switch</Text>
        </Pressable>
        <ListItem icon="📋" label="Terms & Privacy" onPress={() => Linking.openURL("https://www.relifish.com/privacy")} />
        <ListItem icon="🗑️" label="Delete my account" onPress={() => Linking.openURL("https://www.relifish.com/data-deletion")} />
        <Pressable onPress={async () => { await setSession(null); load(); }} style={{ marginTop: 8, marginHorizontal: 16, marginBottom: 4, padding: 13, borderRadius: 12, borderWidth: 1, borderColor: t.border, alignItems: "center" }}><Text style={{ fontSize: 13, fontWeight: "700", color: t.red }}>Log out</Text></Pressable>
        <Text style={{ textAlign: "center", fontSize: 10, color: t.ink4, paddingTop: 12, paddingBottom: 24 }}>Made in Mumbai · v{Constants.expoConfig?.version}</Text>
      </ScrollView>
      <Modal visible={edit} transparent animationType="slide" onRequestClose={() => setEdit(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(15, 23, 42, 0.5)" }} onPress={() => setEdit(false)} />
        <View style={{ backgroundColor: t.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 24 }}>
          <SheetHeader title="Edit profile" onClose={() => setEdit(false)} />
          <View style={{ padding: 16, gap: 12 }}>
            <View style={{ flexDirection: "row", gap: 10 }}><View style={{ flex: 1 }}><Input label="First name" value={form.first_name} onChangeText={(v) => setForm({ ...form, first_name: v })} /></View><View style={{ flex: 1 }}><Input label="Last name" value={form.last_name} onChangeText={(v) => setForm({ ...form, last_name: v })} /></View></View>
            <Input label="Email (for order updates)" keyboardType="email-address" autoCapitalize="none" value={form.email} onChangeText={(v) => setForm({ ...form, email: v })} success={profile?.email_verified && form.email === profile?.email ? "Verified" : undefined} />
            {form.email && !(profile?.email_verified && form.email === profile?.email) ? <Button title="Send verification" variant="secondary" full onPress={verifyEmail} /> : null}
            <Button title="Save" full loading={busy} onPress={save} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

function ListItem({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  const t = useTheme();
  return <Pressable onPress={onPress} style={{ marginHorizontal: 16, marginBottom: 1, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: t.border, backgroundColor: t.bg }}><Text style={{ fontSize: 18 }}>{icon}</Text><Text style={{ flex: 1, fontSize: 14, fontWeight: "600" }}>{label}</Text><Text style={{ color: t.ink4, fontSize: 18 }}>›</Text></Pressable>;
}
