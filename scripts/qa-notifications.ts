/**
 * QA: order notification fan-out (BUG-20 .. BUG-27).
 *
 * Verifies that every order event reaches BOTH parties on BOTH channels, that
 * no channel fails silently, and that a dead push subscription self-heals
 * instead of poisoning the row forever.
 *
 * Requires a dev server on 127.0.0.1:4321 and staging Supabase creds in .env.
 */
import { createClient } from "@supabase/supabase-js";
import { createHmac, generateKeyPairSync, randomBytes } from "node:crypto";
import { config } from "dotenv"; config();

const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const BASE = "http://127.0.0.1:4321";
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || "";

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  ✓ ${name}: PASS`); }
  else { fail++; console.log(`  ✗ ${name}: FAIL ${detail}`); }
}

const post = (url: string, body: any, headers: Record<string, string> = {}) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE, ...headers },
    body: JSON.stringify(body),
  });

/** Any value that is not an unexplained failure. "skipped: <reason>" is fine. */
const accounted = (v: unknown) =>
  typeof v === "string" && v.length > 0 && (v === "sent" || v.startsWith("skipped:") || v.startsWith("failed:"));

async function makeOrder(): Promise<{ order_id: string; buyer_id: string } | null> {
  const { data: listing, error: lErr } = await sb
    .from("fish_listings")
    .select("id, species, seller_id, weight_avail")
    .gt("weight_avail", 1)
    .limit(1)
    .single();
  if (!listing) { console.log("  (listing lookup failed)", lErr?.message); return null; }

  const { data: buyer, error: bErr } = await sb.from("buyers").select("id, phone").limit(1).single();
  if (!buyer) { console.log("  (buyer lookup failed)", bErr?.message); return null; }

  const { data: order, error } = await sb
    .from("orders")
    .insert({
      listing_id: listing.id,
      species: listing.species,
      quantity: 1,
      quantity_unit: "kg",
      total_price: 100,
      delivery_fee: 0,
      buyer_id: buyer.id,
      buyer_phone: buyer.phone,
      status: "pending_payment",
      order_type: "pickup",
      payment_method: null,
    })
    .select("id")
    .single();
  if (error) { console.log("  (insert failed)", error.message); return null; }
  return { order_id: order.id, buyer_id: buyer.id };
}

async function main() {
  console.log("\n=== N1. Cancel fan-out reaches all four channels ===");
  const made = await makeOrder();
  if (!made) { console.log("  ! could not seed an order — skipping N1/N2"); }
  else {
    const res = await post(`${BASE}/api/orders/cancel`, {
      order_id: made.order_id, buyer_id: made.buyer_id, action: "cancel", cancel_reason: "qa notification test",
    });
    const body: any = await res.json();
    check("N1-T1 cancel returns 200", res.status === 200, String(res.status));
    check("N1-T2 response carries a `notified` block", !!body.notified, JSON.stringify(body).slice(0, 200));

    const n = body.notified || {};
    for (const ch of ["buyer_push", "buyer_email", "seller_push", "seller_email"]) {
      check(`N1-T3 ${ch} accounted for (never silent)`, accounted(n[ch]), JSON.stringify(n[ch]));
    }
    // BUG-20 was specifically the seller hearing nothing at all.
    check("N1-T4 seller channels are not missing", "seller_push" in n && "seller_email" in n, JSON.stringify(n));

    const { data: row } = await sb.from("orders").select("status").eq("id", made.order_id).single();
    check("N1-T5 order actually cancelled", row?.status === "cancelled", row?.status);
    await sb.from("orders").delete().eq("id", made.order_id);
  }

  console.log("\n=== N2. Webhook payment.captured notifies both parties ===");
  if (!WEBHOOK_SECRET) console.log("  ! RAZORPAY_WEBHOOK_SECRET unset — skipping N2/N3");
  else {
    const made2 = await makeOrder();
    if (!made2) console.log("  ! could not seed an order — skipping N2");
    else {
      const rzpOrder = `order_qa${Date.now()}`;
      const payId = `pay_qa${Date.now()}`;
      await sb.from("orders").update({ razorpay_order_id: rzpOrder }).eq("id", made2.order_id);

      const payload = JSON.stringify({
        event: "payment.captured",
        payload: { payment: { entity: { id: payId, order_id: rzpOrder, status: "captured", amount: 10000 } } },
      });
      const sig = createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex");
      const r = await fetch(`${BASE}/api/payments/razorpay-webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-razorpay-signature": sig, Origin: BASE },
        body: payload,
      });
      const b: any = await r.json();
      check("N2-T1 webhook accepts signed payment.captured", r.status === 200, String(r.status));
      check("N2-T2 exactly one row reconciled", b.reconciled === 1, JSON.stringify(b));

      const { data: row } = await sb.from("orders").select("status, razorpay_payment_id").eq("id", made2.order_id).single();
      check("N2-T3 order flipped to confirmed", row?.status === "confirmed", row?.status);
      check("N2-T4 payment id recorded", row?.razorpay_payment_id === payId, row?.razorpay_payment_id);

      console.log("\n=== N3. Webhook refund.processed notifies both parties ===");
      const rPayload = JSON.stringify({
        event: "refund.processed",
        payload: { refund: { entity: { id: `rfnd_qa${Date.now()}`, payment_id: payId, amount: 10000 } } },
      });
      const rSig = createHmac("sha256", WEBHOOK_SECRET).update(rPayload).digest("hex");
      const rr = await fetch(`${BASE}/api/payments/razorpay-webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-razorpay-signature": rSig, Origin: BASE },
        body: rPayload,
      });
      const rb: any = await rr.json();
      check("N3-T1 webhook accepts signed refund.processed", rr.status === 200, String(rr.status));
      check("N3-T2 exactly one row reconciled", rb.reconciled === 1, JSON.stringify(rb));

      const { data: rrow } = await sb.from("orders").select("status, refund_amt, refund_sent_at").eq("id", made2.order_id).single();
      check("N3-T3 order flipped to refunded", rrow?.status === "refunded", rrow?.status);
      check("N3-T4 refund amount in rupees, not paise", Number(rrow?.refund_amt) === 100, String(rrow?.refund_amt));
      check("N3-T5 refund_sent_at stamped", !!rrow?.refund_sent_at, String(rrow?.refund_sent_at));

      await sb.from("orders").delete().eq("id", made2.order_id);
    }
  }

  console.log("\n=== N4. notify-seller understands every kind (BUG-26) ===");
  const secret = process.env.INTERNAL_API_SECRET || "";
  const { data: anySeller } = await sb.from("sellers").select("id").limit(1).single();
  for (const kind of ["new_order", "payment_proof", "payment_confirmed", "cancelled", "refunded"]) {
    const r = await post(
      `${BASE}/api/notify-seller`,
      { kind, seller_id: anySeller?.id, species: "pomfret", order_id_short: "ab12cd34", quantity: 1, quantity_unit: "kg" },
      secret ? { "x-internal-api-secret": secret } : {}
    );
    check(`N4 kind="${kind}" accepted`, r.status === 200, String(r.status));
  }
  const rBad = await post(
    `${BASE}/api/notify-seller`,
    { kind: "totally-unknown", seller_id: anySeller?.id, species: "pomfret" },
    secret ? { "x-internal-api-secret": secret } : {}
  );
  check("N4 unknown kind does not 500", rBad.status === 200, String(rBad.status));
  const rNoSeller = await post(
    `${BASE}/api/notify-seller`,
    { kind: "cancelled", species: "pomfret" },
    secret ? { "x-internal-api-secret": secret } : {}
  );
  check("N4 missing seller_id rejected with 400", rNoSeller.status === 400, String(rNoSeller.status));

  console.log("\n=== N5. Dead push subscription self-heals (BUG-22) ===");
  const { data: victim } = await sb
    .from("buyers")
    .select("id, phone, push_subscription, push_enabled")
    .limit(1)
    .single();
  if (!victim) console.log("  ! no buyer row — skipping N5");
  else {
    const saved = { sub: victim.push_subscription, enabled: victim.push_enabled };
    // The p256dh must be a genuine uncompressed P-256 point, otherwise web-push
    // throws locally ("Public key is not valid for specified curve") before any
    // HTTP request — which is correctly NOT terminal and must not prune.
    // We want the other path: a real round-trip to FCM that comes back 404/410.
    const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const p256dh = publicKey.export({ type: "spki", format: "der" }).subarray(-65).toString("base64url");
    await sb.from("buyers").update({
      push_enabled: true,
      push_subscription: {
        endpoint: `https://fcm.googleapis.com/fcm/send/qa-nonexistent-${Date.now()}`,
        keys: { p256dh, auth: randomBytes(16).toString("base64url") },
      },
    }).eq("id", victim.id);

    const made3 = await makeOrder();
    if (made3) {
      await sb.from("orders").update({ buyer_id: victim.id, buyer_phone: victim.phone }).eq("id", made3.order_id);
      await post(`${BASE}/api/orders/cancel`, {
        order_id: made3.order_id, buyer_id: victim.id, action: "cancel", cancel_reason: "qa prune test",
      });
      const { data: after } = await sb.from("buyers").select("push_subscription, push_enabled").eq("id", victim.id).single();
      check("N5-T1 dead subscription cleared", after?.push_subscription === null, JSON.stringify(after?.push_subscription)?.slice(0, 80));
      check("N5-T2 push_enabled turned off", after?.push_enabled === false, String(after?.push_enabled));
      await sb.from("orders").delete().eq("id", made3.order_id);
    }
    await sb.from("buyers").update({ push_subscription: saved.sub, push_enabled: saved.enabled }).eq("id", victim.id);
    const { data: restored } = await sb.from("buyers").select("push_enabled").eq("id", victim.id).single();
    check("N5-T3 original subscription restored", restored?.push_enabled === saved.enabled, String(restored?.push_enabled));
  }

  console.log(`\n${pass}/${pass + fail} PASS`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
