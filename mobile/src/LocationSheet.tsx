/**
 * "Set your area" sheet = organisms/LocationPickerSheet.astro: "Your area is enough…" + Use current location, "or",
 * type-ahead over the same Thane localities (src/lib/areas LOCALITIES) then Nominatim, Confirm area.
 * The site's optional "or move the pin" map is not in the app (no map SDK); typing or GPS covers the same need.
 */
import { useMemo, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LOCALITIES } from "../../src/lib/areas";
import { myLocation, reverseArea, saveBuyerLocation, type BuyerLocation } from "./catalog";
import { useTheme } from "./theme";
import { Button, Input, SheetHeader } from "./ui/atoms";
import { Text } from "./ui/base";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function LocationSheet({ visible, current, onClose, onPicked }: { visible: boolean; current: BuyerLocation | null; onClose: () => void; onPicked: (l: BuyerLocation) => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<BuyerLocation | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const sugg = useMemo(() => {
    const n = norm(q);
    if (n.length < 2) return [];
    return (LOCALITIES.thane as unknown as [string, number, number][]).filter(([name]) => norm(name).includes(n)).slice(0, 5).map(([area, lat, lng]) => ({ area, lat, lng }));
  }, [q]);
  async function gps() {
    setBusy(true); setErr("");
    const at = await myLocation();
    if (!at.fromPhone) { setErr("Location is off. Allow location for Relifish, or type your area."); setBusy(false); return; }
    const l = { lat: at.lat, lng: at.lng, area: await reverseArea(at.lat, at.lng) };
    setBusy(false); await saveBuyerLocation(l); onPicked(l);
  }
  async function search() {
    setBusy(true); setErr("");
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=in&viewbox=72.75,19.45,73.25,18.85&bounded=1&q=${encodeURIComponent(q)}`, { headers: { "User-Agent": "Relifish-app" } });
      const [hit] = await r.json();
      if (hit) setPick({ lat: Number(hit.lat), lng: Number(hit.lon), area: q.trim() }); else setErr("We couldn't find that area. Try a nearby locality.");
    } catch { setErr("No connection. Try again."); }
    setBusy(false);
  }
  const chosen = pick ?? sugg[0] ?? null;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(15, 23, 42, 0.5)" }} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ backgroundColor: t.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: insets.bottom + 12 }}>
        <SheetHeader title="Set your area" onClose={onClose} />
        <View style={{ padding: 16, gap: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text style={{ flex: 1, fontSize: 13, lineHeight: 18, color: t.ink2 }}>Your area is enough, e.g. <Text style={{ fontWeight: "700" }}>Thane West</Text>, <Text style={{ fontWeight: "700" }}>Majiwada</Text>, <Text style={{ fontWeight: "700" }}>Mulund</Text></Text>
            <Button title="📍 Use current location" variant="secondary" size="sm" loading={busy && !q} onPress={gps} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}><View style={{ flex: 1, height: 1, backgroundColor: t.border }} /><Text style={{ fontSize: 11, fontWeight: "700", letterSpacing: 0.88, color: t.ink3, textTransform: "uppercase" }}>or</Text><View style={{ flex: 1, height: 1, backgroundColor: t.border }} /></View>
          <Input label="Type your area, e.g. Thane, Mulund" placeholder="e.g. Thane, Majiwada, Mulund" value={q} onChangeText={(v) => { setQ(v); setPick(null); }} onSubmitEditing={search} returnKeyType="search" />
          {sugg.length ? <View style={{ borderWidth: 1, borderColor: t.border, borderRadius: 12, overflow: "hidden" }}>{sugg.map((s) => (
            <Pressable key={s.area} onPress={() => { setQ(s.area); setPick(s); }} style={{ paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: t.border, backgroundColor: pick?.area === s.area ? t.brandL : t.bg }}><Text style={{ fontSize: 14, fontWeight: "600" }}>{s.area}</Text><Text style={{ fontSize: 12, color: t.ink3 }}>Thane</Text></Pressable>
          ))}</View> : null}
          {err ? <Text style={{ fontSize: 12, color: t.red }}>{err}</Text> : null}
          {current ? <Text style={{ fontSize: 12, color: t.ink3 }}>Now: {current.area}</Text> : null}
          <Button title="Confirm area" full disabled={!chosen && q.trim().length < 3} loading={busy && !!q} onPress={async () => { if (chosen) { await saveBuyerLocation(chosen); onPicked(chosen); } else await search(); }} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
