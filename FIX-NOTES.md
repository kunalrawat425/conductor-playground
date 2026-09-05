# FIX-NOTES — Relifish payment reconciliation

Concrete patches ranked by severity. Each block: **file path** · **why** ·
**diff sketch**. Apply after QA-REPORT.md is reviewed.

---

## FIX #1 (S1) — Add Razorpay webhook endpoint

**Root cause of "payment made but did not reflect".** Currently the only
path that flips `orders.status='confirmed'` is the client-side handler in
`track/[id].astro:1153`. If the tab dies between Razorpay success and the
POST, the payment is orphaned forever.

### New file: `src/pages/api/payments/razorpay-webhook.ts`

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";
const RAZORPAY_WEBHOOK_SECRET = import.meta.env.RAZORPAY_WEBHOOK_SECRET || "";

export const POST: APIRoute = async ({ request }) => {
  if (!RAZORPAY_WEBHOOK_SECRET) {
    return new Response("Webhook not configured", { status: 503 });
  }

  const raw = await request.text();
  const signature = request.headers.get("x-razorpay-signature") || "";
  const expected = createHmac("sha256", RAZORPAY_WEBHOOK_SECRET).update(raw).digest("hex");

  const a = Buffer.from(signature, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return new Response("Invalid signature", { status: 400 });
  }

  const event = JSON.parse(raw) as {
    event: string;
    payload: { payment: { entity: { id: string; order_id: string; status: string } } };
  };

  // Only care about captured payments — Razorpay retries these
  if (event.event !== "payment.captured") {
    return new Response("ignored", { status: 200 });
  }

  const { id: razorpay_payment_id, order_id: razorpay_order_id } = event.payload.payment.entity;
  const sb = createClient(supabaseUrl, supabaseServiceKey);

  // Idempotent flip: only update rows that are still pending
  const { data, error } = await sb
    .from("orders")
    .update({
      status: "confirmed",
      payment_method: "razorpay",
      razorpay_payment_id,
      payment_verified_at: new Date().toISOString(),
    })
    .eq("razorpay_order_id", razorpay_order_id)
    .in("status", ["pending", "pending_payment"])
    .select("id");

  if (error) {
    console.error("[razorpay-webhook] update failed", error);
    return new Response("Update failed", { status: 500 });
  }

  // 0 rows updated = already confirmed via client handler — still OK
  return new Response(JSON.stringify({ ok: true, reconciled: data?.length ?? 0 }), { status: 200 });
};
```

### Config steps

1. Add env var `RAZORPAY_WEBHOOK_SECRET` in Vercel (all 3 environments)
2. In Razorpay Dashboard → Settings → Webhooks → Add:
   - URL: `https://relifish.store/api/payments/razorpay-webhook`
   - Events: `payment.captured`
   - Secret: paste the same value as `RAZORPAY_WEBHOOK_SECRET`
3. Send a test event from Razorpay dashboard, confirm 200

### Backfill script for the 2 known orphans (post-webhook)

```ts
// scripts/backfill-orphan-razorpay.ts
// Run once after webhook is live. Reads Razorpay dashboard state for each
// orphan and reconciles manually.
import Razorpay from "razorpay"; // OR use fetch to https://api.razorpay.com/v1/orders/:id/payments
```

---

## FIX #2 (S1) — Buyer `/me` hides in-flight orders

`src/pages/api/buyer/orders.ts:30` filters to past statuses only:
```ts
const pastStatuses = ["picked_up","completed","declined","cancelled","refunded"];
```
Buyer with a `pending_payment` order sees "No past orders yet" in `/me` and
concludes their payment vanished. Fix: return ALL statuses and let the UI
group them into "In progress" and "Past".

### Patch — `src/pages/api/buyer/orders.ts`

```ts
// Remove pastStatuses filter entirely. Return all statuses ordered by created_at.
// Client (me.astro) groups them.
const { data: orders, count, error } = await sb
  .from("orders")
  .select("id, status, created_at, total_price, quantity, quantity_unit, cut_style, buyer_notes, placement_kind, razorpay_order_id, razorpay_payment_id, payment_verified_at, listing:fish_listings(species, seller:sellers(name))", { count: "exact" })
  .or(orClause)
  .order("created_at", { ascending: false })
  .range(offset, offset + page_size - 1);
```

### Patch — `src/pages/me.astro:673`

Split rendering into two sections:
```ts
const IN_FLIGHT = new Set(["pending","pending_payment","confirmed","ready_for_pickup","out_for_delivery"]);
const active = orders.filter(o => IN_FLIGHT.has(o.status));
const past = orders.filter(o => !IN_FLIGHT.has(o.status));

el.innerHTML = `
  ${active.length ? `<h4 class="v2-me-section-head">Active orders</h4>${active.map(renderCard).join('')}` : ''}
  ${past.length ? `<h4 class="v2-me-section-head">Past orders</h4>${past.map(renderCard).join('')}` : '<div class="v2-me-addr-empty">No past orders yet.</div>'}
`;
```

Active orders should get a prominent "Complete payment" or "Track" CTA.

---

## FIX #3 (S1) — Seller dashboard: add "Reconcile with Razorpay" button

`dashboard/orders/index.astro:725` shows *"Waiting for buyer to complete
Razorpay payment. No action needed."* Seller has no way to verify whether the
payment actually captured on Razorpay's side. Add a manual reconcile button
that fetches the Razorpay order + linked payments and, if a captured payment
exists, flips the row to `confirmed`.

### New file: `src/pages/api/seller/reconcile-razorpay.ts`

```ts
import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const { order_id, seller_id } = await request.json();
  if (!order_id || !seller_id) return new Response(JSON.stringify({ error: "order_id + seller_id required" }), { status: 400 });

  const sb = createClient(import.meta.env.PUBLIC_SUPABASE_URL!, import.meta.env.SUPABASE_SERVICE_KEY!);
  const { data: order } = await sb.from("orders").select("id, razorpay_order_id, status, listing:fish_listings(seller_id)").eq("id", order_id).single();

  // Verify seller owns this order
  if (!order || (order.listing as any)?.seller_id !== seller_id) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403 });
  }
  if (!order.razorpay_order_id) return new Response(JSON.stringify({ error: "No Razorpay order on this row" }), { status: 400 });
  if (order.status === "confirmed") return new Response(JSON.stringify({ ok: true, already: true }), { status: 200 });

  const auth = Buffer.from(`${import.meta.env.PUBLIC_RAZORPAY_KEY_ID}:${import.meta.env.RAZORPAY_KEY_SECRET}`).toString("base64");
  const res = await fetch(`https://api.razorpay.com/v1/orders/${order.razorpay_order_id}/payments`, { headers: { Authorization: `Basic ${auth}` } });
  const body = await res.json();
  const captured = (body.items || []).find((p: any) => p.status === "captured");
  if (!captured) return new Response(JSON.stringify({ ok: false, message: "No captured payment on Razorpay side" }), { status: 200 });

  await sb.from("orders").update({
    status: "confirmed",
    payment_method: "razorpay",
    razorpay_payment_id: captured.id,
    payment_verified_at: new Date().toISOString(),
    payment_verified_by: null,
  }).eq("id", order_id).in("status", ["pending","pending_payment"]);

  return new Response(JSON.stringify({ ok: true, payment_id: captured.id }), { status: 200 });
};
```

### UI patch — `dashboard/orders/index.astro:725`

Replace the "No action needed" copy with:
```html
<button class="v2-btn v2-btn-sm" data-reconcile-order-id="${o.id}">
  🔄 Check Razorpay for payment
</button>
```
Wire button to POST `/api/seller/reconcile-razorpay`. On `{ok:true}`, refresh
the row. On `{ok:false}`, show the "still no payment" message.

This gives sellers a manual escape hatch even before the webhook lands.

---

## FIX #4 (was #2) — Guard against confirmed-without-payment

50 legacy rows already have `status='confirmed'` and no payment record.
Add a DB constraint to prevent new ones + a scheduled reconciliation job.

### Migration: `supabase/migrations/YYYYMMDD_orders_confirmed_needs_payment.sql`

```sql
-- Any row entering `confirmed` must have either a Razorpay payment
-- OR a verified screenshot OR a legacy COD marker.
alter table orders
  add constraint orders_confirmed_needs_payment
  check (
    status <> 'confirmed'
    OR razorpay_payment_id is not null
    OR payment_verified_at is not null
    OR payment_method = 'cod_legacy'
  ) not valid;   -- 'not valid' so it applies only to new rows; run VALIDATE separately after backfill.
```

### One-time cleanup

```sql
-- Backfill legacy pre-Razorpay orders
update orders
set payment_method = 'cod_legacy',
    payment_verified_at = created_at
where status = 'confirmed'
  and razorpay_payment_id is null
  and payment_verified_at is null
  and created_at < '2026-05-01';  -- Razorpay went live mid-May
```

Then `alter table orders validate constraint orders_confirmed_needs_payment;`.

---

## FIX #3 (S2) — Invalidate stale `razorpay_order_id` on price change

`create-order.ts:54` returns the cached Razorpay order id without comparing
amounts. If `total_price` was updated between two clicks, the second click
opens the Razorpay modal at the **old** amount; when the buyer pays, verify.ts
rejects at line 66 with a confusing "Payment does not match this order" 400.

### Patch — `src/pages/api/payments/razorpay-create-order.ts`

Replace lines 53–67 with:

```ts
// Idempotency — reuse existing Razorpay order ONLY if amount still matches
if (order.razorpay_order_id) {
  const currentAmountPaise = Math.round(
    (Number(order.total_price) + Number(order.delivery_fee || 0)) * 100
  );
  // Fetch the Razorpay order to compare stored amount
  const credentials = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString("base64");
  const check = await fetch(`https://api.razorpay.com/v1/orders/${order.razorpay_order_id}`, {
    headers: { Authorization: `Basic ${credentials}` },
  }).catch(() => null);
  const cached = await check?.json().catch(() => null);
  if (cached?.amount === currentAmountPaise) {
    return new Response(JSON.stringify({
      razorpay_order_id: order.razorpay_order_id,
      amount: currentAmountPaise, currency: "INR", key_id: RAZORPAY_KEY_ID,
    }), { status: 200 });
  }
  // Amount changed — clear stale reference and fall through to create a new one
  await supabase.from("orders").update({ razorpay_order_id: null }).eq("id", order_id);
}
```

---

## FIX #4 (S2) — Stale `pending_payment` cleanup cron

50+ rows sitting `pending_payment` for weeks. Add a nightly Vercel cron.

### New file: `src/pages/api/cron/expire-pending-orders.ts`

```ts
import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const cronSecret = import.meta.env.CRON_SECRET || "";
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const sb = createClient(import.meta.env.PUBLIC_SUPABASE_URL!, import.meta.env.SUPABASE_SERVICE_KEY!);
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  // Only cancel rows that never got a Razorpay payment attempt.
  // Rows with razorpay_order_id set could still capture via webhook — leave.
  const { data, error } = await sb
    .from("orders")
    .update({ status: "cancelled", cancel_reason: "auto_expired_payment" })
    .in("status", ["pending", "pending_payment"])
    .is("razorpay_order_id", null)
    .lt("created_at", cutoff)
    .select("id");

  return new Response(JSON.stringify({ ok: true, expired: data?.length ?? 0, error: error?.message }), { status: 200 });
};
```

### Add to `vercel.json`

```json
{
  "crons": [
    { "path": "/api/cron/expire-pending-orders", "schedule": "0 3 * * *" }
  ]
}
```

---

## FIX #5 (S3) — Structured logging in Razorpay verify

`verify.ts:113,177,224` swallow every downstream error silently. If Resend or
seller-push fails, no one knows. Wrap each with a `console.warn` including
`order_id` so Vercel logs surface the failure.

```ts
// verify.ts:115 — replace `.catch(() => {})` with:
.catch((err) => console.warn("[razorpay-verify] buyer push failed", { order_id, err }));
```

Apply the same wrap on lines 177 (email send) and 224 (seller notify).

---

## Regression tests (new vitest cases — post-fix)

Add to `tests/lib/razorpay-webhook.test.ts`:

1. Valid signature + payment.captured event with matching `razorpay_order_id`
   → row flips to `confirmed`
2. Valid signature + already-confirmed row → no-op, 200 with `reconciled=0`
3. Invalid signature → 400
4. `payment.captured` for unknown `razorpay_order_id` → 200 (idempotent, no row)
5. `payment.failed` event → 200, ignored (no status change)

Add to `tests/lib/order-create-idempotency.test.ts`:

6. `razorpay-create-order` called twice with same total → same `razorpay_order_id`
7. `total_price` changed between calls → new `razorpay_order_id`

---

## Deployment order

1. Merge FIX #5 first (logging) — trivial, gives visibility
2. FIX #3 (stale amount) — small blast radius
3. FIX #1 (webhook) — deploy code, then configure Razorpay dashboard, then
   backfill the 2 orphan rows
4. FIX #2 (constraint) — after backfill runs; validate constraint separately
5. FIX #4 (expiry cron) — last; visible user impact (auto-cancel)

All five together: est ~4 hours of coding + 1 hour of Razorpay dashboard
config + testing.
