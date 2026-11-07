/** Buyer orders + tracking, from pages/track.astro and pages/track/[id].astro. Values from public/design-system/live.html. */
import { Pressable, View } from "react-native";
import { lit, useTheme } from "../theme";
import { grad, lh, row, Text } from "./base";
import { Badge } from "./shop";

export type StepDot = { label: string; state: "done" | "fail" | "todo" | "now" };
/** .v2-stepper: dots (done ✓ green, failed ✕ red, todo grey) joined by 2 px lines, labels under (11/500, last bold coloured). */
export function Stepper({ steps, size = 22, labelSize = 11, failLine }: { steps: StepDot[]; size?: number; labelSize?: number; failLine?: string }) {
  const t = useTheme();
  const col = (s: StepDot["state"]) => (s === "done" ? t.green : s === "fail" ? t.red : s === "now" ? t.brand : "#CBD5E1");
  return (
    <View>
      <View style={row}>
        {steps.map((s, i) => (
          <View key={i} style={[row, { flex: i ? 1 : 0 }]}>
            {i ? <View style={{ flex: 1, height: 2, marginHorizontal: 4, backgroundColor: s.state === "fail" ? failLine ?? t.green : s.state === "todo" || s.state === "now" ? "#CBD5E1" : t.green }} /> : null}
            <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: col(s.state), alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 11, fontWeight: "700", color: "#FFFFFF" }}>{s.state === "done" ? "✓" : s.state === "fail" ? "✕" : String(i + 1)}</Text></View>
          </View>
        ))}
      </View>
      <View style={[row, { justifyContent: "space-between", marginTop: 6 }]}>
        {steps.map((s, i) => <Text key={i} style={{ fontSize: labelSize, lineHeight: lh(labelSize), fontWeight: s.state === "fail" || s.state === "now" ? "700" : "500", color: s.state === "fail" ? t.red : s.state === "now" ? t.brand : t.ink3 }}>{s.label}</Text>)}
      </View>
    </View>
  );
}

const TONE: Record<string, "red" | "green" | "orange" | "indigo" | "brand"> = { red: "red", green: "green", amber: "orange", indigo: "indigo", purple: "indigo", brand: "brand" };
/** track.astro card: caps status 10/700 + outlined badge, seller 15/800, "Order #ID · qty · Today" 11, stepper; cancelled = red-tinted border. */
export function BuyerOrderCard({ status, tone, seller, line, steps, onPress, pills, refund }: { status: string; tone: "red" | "green" | "amber" | "indigo" | "brand"; seller: string; line: string; steps: StepDot[]; onPress?: () => void; pills?: React.ReactNode; refund?: string | null }) {
  const t = useTheme();
  const c = { red: t.red, green: t.green, amber: t.orange, indigo: t.indigo, brand: t.brand }[tone];
  return (
    <Pressable onPress={onPress} style={{ marginHorizontal: 16, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: tone === "red" ? lit.redSoftBorder : t.border, backgroundColor: t.bg }}>
      <View style={[row, { justifyContent: "space-between" }]}>
        <Text style={{ fontSize: 10, lineHeight: lh(10), letterSpacing: 0.5, fontWeight: "700", textTransform: "uppercase", color: c }}>{status}</Text>
        <View style={[row, { gap: 4 }]}>{pills}<Badge text={status} color={TONE[tone]} /></View>
      </View>
      <Text style={{ marginTop: 6, fontSize: 15, lineHeight: lh(15), fontWeight: "800" }}>{seller}</Text>
      <Text style={{ marginTop: 2, fontSize: 11, lineHeight: lh(11), color: t.ink3 }}>{line}</Text>
      <View style={{ marginTop: 10 }}><Stepper steps={steps} failLine={lit.redSoftBorder} /></View>
      {refund ? <View style={{ marginTop: 10, paddingVertical: 8, paddingHorizontal: 10, backgroundColor: "#F5F3FF", borderRadius: 6 }}><Text style={{ fontSize: 11, fontWeight: "600", color: "#7C3AED" }}>{refund}</Text></View> : null}
    </Pressable>
  );
}

/** Small caps pill used on order cards (kind / method / payment): 10/700, 2/8 pad, 1 px border. */
export function OrderPill({ text, bg, fg, border }: { text: string; bg: string; fg: string; border?: string }) {
  return <View style={{ backgroundColor: bg, borderWidth: border ? 1 : 0, borderColor: border, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 8 }}><Text style={{ fontSize: 10, lineHeight: lh(10), letterSpacing: 0.4, fontWeight: "700", textTransform: "uppercase", color: fg }}>{text}</Text></View>;
}

/** .v2-active-order: light-blue gradient card, #93C5FD border, pills row, seller 16/800, sub 12, slot / prep lines, stepper. */
export function ActiveOrderCard({ pills, seller, sub, slot, prep, steps, onPress }: { pills: React.ReactNode; seller: string; sub: string; slot?: string | null; prep?: string | null; steps: StepDot[]; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={[{ marginHorizontal: 16, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: "#93C5FD" }, grad("linear-gradient(135deg, #E6F0FF, #DBEAFE)")]}>
      <View style={[row, { gap: 4, flexWrap: "wrap", marginBottom: 6 }]}>{pills}</View>
      <Text style={{ fontSize: 16, lineHeight: lh(16), fontWeight: "800", color: "#1E293B" }}>{seller}</Text>
      <Text style={{ marginTop: 4, fontSize: 12, lineHeight: lh(12), color: "#475569" }}>{sub}</Text>
      {slot ? <Text style={{ marginTop: 4, fontSize: 12, fontWeight: "700", color: "#0F172A" }}>🕘 {slot}</Text> : null}
      {prep ? <Text style={{ marginTop: 4, fontSize: 11, fontWeight: "500", color: "#475569" }}>{prep}</Text> : null}
      <View style={{ marginTop: 16 }}><Stepper steps={steps} /></View>
    </Pressable>
  );
}

/** .v2-od-hero: 16 radius gradient by status (green / red / amber / indigo / purple / brand), status 18/800, "Order #ID", time. */
export function StatusHero({ status, id, time, tone }: { status: string; id: string; time?: string; tone: keyof typeof lit.odHero }) {
  return (
    <View style={[{ marginHorizontal: 16, marginTop: 16, paddingVertical: 20, paddingHorizontal: 16, borderRadius: 16, alignItems: "center" }, grad(lit.odHero[tone])]}>
      <Text style={{ fontSize: 18, lineHeight: lh(18), fontWeight: "800", color: "#FFFFFF" }}>{status}</Text>
      <Text style={{ marginTop: 8, fontSize: 12, lineHeight: lh(12), fontWeight: "600", color: "#FFFFFF", opacity: 0.9 }}>Order {id}</Text>
      {time ? <Text style={{ marginTop: 2, fontSize: 11, lineHeight: lh(11), color: "#FFFFFF", opacity: 0.8 }}>{time}</Text> : null}
    </View>
  );
}

/** .v2-od-section: white card, 12 radius, 14 pad, caps heading 11/700 (0.44 ls). */
export function InfoSection({ title, children }: { title?: string; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ marginHorizontal: 16, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: t.border, backgroundColor: t.bg }}>
      {title ? <Text style={{ marginBottom: 8, fontSize: 11, lineHeight: lh(11), letterSpacing: 0.44, fontWeight: "700", textTransform: "uppercase", color: t.ink3 }}>{title}</Text> : null}
      {children}
    </View>
  );
}

export type BillLine = { k: string; v: string; strong?: boolean; rule?: boolean };
/** .v2-od-bill rows: 13/500 ink-2; Total 15/800 with a rule above; note 11 ink-3. */
export function BillSummary({ rows, note }: { rows: BillLine[]; note?: string }) {
  const t = useTheme();
  return (
    <InfoSection title="Bill summary">
      {rows.map((r, i) => (
        <View key={i} style={[row, { justifyContent: "space-between", paddingTop: r.rule ? (r.strong ? 8 : 6) : 4, paddingBottom: 4, borderTopWidth: r.rule ? 1 : 0, borderTopColor: t.border }]}>
          <Text style={{ fontSize: r.strong ? 15 : 13, lineHeight: lh(r.strong ? 15 : 13), fontWeight: r.strong ? "800" : "500", color: r.strong ? t.ink : t.ink2 }}>{r.k}</Text>
          <Text style={{ fontSize: r.strong ? 15 : 13, lineHeight: lh(r.strong ? 15 : 13), fontWeight: r.strong ? "800" : r.rule ? "700" : "500", color: r.strong || r.rule ? t.ink : t.ink2 }}>{r.v}</Text>
        </View>
      ))}
      {note ? <Text style={{ paddingVertical: 4, fontSize: 11, lineHeight: lh(11), color: t.ink3 }}>{note}</Text> : null}
    </InfoSection>
  );
}

export type TimelineStep = { label: string; sub?: string; state: "done" | "now" | "todo" | "fail" };
/** Order tracking timeline (preview "Tracking"): green ticks for done, a numbered blue dot for now, grey for next; 2 px rail. */
export function Timeline({ steps }: { steps: TimelineStep[] }) {
  const t = useTheme();
  return (
    <View style={{ marginHorizontal: 16, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: t.border, backgroundColor: t.bg }}>
      {steps.map((s, i) => {
        const c = s.state === "done" ? t.green : s.state === "fail" ? t.red : s.state === "now" ? t.brand : t.bg3;
        return (
          <View key={i} style={{ flexDirection: "row", gap: 14 }}>
            <View style={{ alignItems: "center", width: 24 }}>
              <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: s.state === "now" ? t.bg : c, borderWidth: s.state === "now" ? 2 : 0, borderColor: c, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontSize: 12, fontWeight: "800", color: s.state === "now" ? t.brand : s.state === "todo" ? t.ink4 : "#FFFFFF" }}>{s.state === "done" ? "✓" : s.state === "fail" ? "✕" : String(i + 1)}</Text>
              </View>
              {i < steps.length - 1 ? <View style={{ flex: 1, width: 2, minHeight: 22, backgroundColor: s.state === "done" ? t.green : t.bg3 }} /> : null}
            </View>
            <View style={{ flex: 1, paddingBottom: i < steps.length - 1 ? 16 : 0 }}>
              <Text style={{ fontSize: 16, lineHeight: 22, fontWeight: "800", color: s.state === "todo" ? t.ink3 : s.state === "fail" ? t.red : t.ink }}>{s.label}</Text>
              {s.sub ? <Text style={{ marginTop: 2, fontSize: 13, color: t.ink3 }}>{s.sub}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Tracking hero: tinted card with a caps kicker, a 24/800 headline and one line under it. */
export function TrackHero({ kicker, title, sub, tone }: { kicker: string; title: string; sub?: string; tone: keyof typeof lit.odHero }) {
  return (
    <View style={[{ marginHorizontal: 16, marginTop: 16, padding: 18, borderRadius: 16 }, grad(lit.odHero[tone])]}>
      <Text style={{ fontSize: 12, fontWeight: "800", letterSpacing: 0.9, color: "#FFFFFF", opacity: 0.9 }}>{kicker}</Text>
      <Text style={{ marginTop: 4, fontSize: 24, lineHeight: 30, fontWeight: "800", color: "#FFFFFF" }}>{title}</Text>
      {sub ? <Text style={{ marginTop: 4, fontSize: 14, lineHeight: 20, color: "#FFFFFF", opacity: 0.92 }}>{sub}</Text> : null}
    </View>
  );
}
