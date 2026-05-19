# Relifish — Security

> Every PR that touches API routes, auth, payments, or data access is reviewed
> against this checklist by `/review` automatically.
> Critical findings block merge. No exceptions.

---

## Threat Model

**What we protect:**
- Buyer phone numbers + addresses
- Seller UPI IDs + payment screenshots
- Order data (amounts, status, buyer identity)
- Payment screenshot uploads (private bucket)

**Who can attack:**
- Unauthenticated users hitting API routes directly
- Authenticated buyers accessing other buyers' data
- Sellers accessing other sellers' orders/listings
- Malicious input via form fields or URL params

---

## Rule 1 — Identity Never Comes From the Request Body

```typescript
// ❌ CRITICAL VULNERABILITY
const buyerId = body.buyer_id; // attacker sets this to any buyer's ID
const { data } = await supabase.from("orders").select("*").eq("buyer_id", buyerId);

// ✅ CORRECT
// buyer_id must come from a server-verified session, not the body
// Until session cookies are implemented, validate via a server-side lookup:
const { data: buyer } = await supabase
  .from("buyers")
  .select("id")
  .eq("phone", verifiedPhone) // phone verified via OTP, stored server-side
  .single();
```

**Current state:** buyer_id comes from localStorage (`rlf_buyer_id`) sent in request body. This is a known gap. Mitigated by Supabase RLS on orders table. **Do not remove RLS.**

---

## Rule 2 — Validate All Inputs at the API Boundary

Every field from `request.json()` is untrusted. Validate type, format, and range before use.

```typescript
// ❌ WRONG — passes raw string to DB
const { seller_id } = body;
await supabase.from("sellers").select("*").eq("id", seller_id);

// ✅ CORRECT
const seller_id = body?.seller_id;
if (!seller_id || typeof seller_id !== "string" || !/^[0-9a-f-]{36}$/.test(seller_id)) {
  return error(400, "invalid seller_id");
}
```

### Validation rules by field type

| Field | Validation |
|-------|-----------|
| UUID (seller_id, buyer_id, order_id) | `/^[0-9a-f-]{36}$/` regex |
| Phone | `/^[6-9]\d{9}$/` via `src/lib/indian-phone.ts` |
| Amount (₹) | `Number.isFinite(n) && n > 0 && n < 1_000_000` |
| Qty | `Number.isInteger(n) && n > 0 && n <= 1000` |
| HH:MM time | `/^\d{2}:\d{2}$/` |
| Free text (notes) | Max 500 chars, strip HTML |
| File upload | MIME type + size check before storage write |

---

## Rule 3 — Seller Data Access Control

```typescript
// ✅ Every seller API route must verify seller owns the resource
const sellerId = body.seller_id;
const authedSeller = await getAuthenticatedSeller(request); // from src/lib/seller-auth.ts
if (authedSeller.id !== sellerId) {
  return error(403, "Forbidden");
}
```

**Never** return another seller's listings, orders, or UPI ID. Even if the seller_id in the request is valid.

---

## Rule 4 — Payment Screenshots Are Private

```typescript
// ❌ WRONG — public URL for payment proof
const publicUrl = supabase.storage.from("order-payments").getPublicUrl(path);
// This URL is permanently accessible by anyone with the path.

// ✅ CORRECT — signed URL, expires in 1 hour
const { data } = await supabase.storage
  .from("order-payments")
  .createSignedUrl(path, 3600);
```

**Bucket rules:**
- `fish-photos` → public (listing photos, store images) — safe to expose
- `order-payments` → **private** — always signed URLs, never public URLs

---

## Rule 5 — No Sensitive Data in Client-Facing Responses

```typescript
// ❌ WRONG — UPI ID exposed to buyer in listing query
const { data } = await supabase
  .from("sellers")
  .select("*, upi_id")  // upi_id should only appear on order detail for that order

// ✅ CORRECT — explicit field list, no sensitive fields
const { data } = await supabase
  .from("sellers")
  .select("id, name, opens_at, closes_at, has_delivery, store_image_url")
```

**Fields never exposed to buyers:**
- `sellers.upi_id` (except on their own order detail)
- `sellers.push_subscription`
- `sellers.email` (unless email verified — profile context)
- `buyers.phone` of other buyers
- Any `payment_screenshot_urls` of other buyers' orders

---

## Rule 6 — File Upload Validation

```typescript
// ✅ Required checks before any storage.upload()
const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

if (file.size > MAX_SIZE) return error(400, "File too large");
if (!ALLOWED_TYPES.includes(file.type)) return error(400, "Invalid file type");

// Also: generate server-side path, never trust client-provided path
const path = `sellers/${sellerId}/store-${Date.now()}.jpg`;
// Never: const path = body.path; ← path traversal vulnerability
```

---

## Rule 7 — XSS — Escape All User-Controlled Output

```typescript
// ❌ WRONG — raw seller name in HTML
innerHTML = `<div>${sellerName}</div>`;

// ✅ CORRECT — escape before injection
function escape(s: string) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]!)
  );
}
innerHTML = `<div>${escape(sellerName)}</div>`;
```

**All user-controlled strings** (seller name, species name, buyer notes, area names) must be escaped before insertion into `innerHTML`, template literals in scripts, or `set:html`.

Astro JSX (`{variable}`) auto-escapes — safe.
`set:html={variable}` does NOT escape — only use with trusted, server-generated content.

---

## Rule 8 — Rate Limiting (Current Gap)

**No rate limiting on OTP endpoint.** Known risk — attacker can request unlimited OTPs.
Supabase's built-in rate limit is the only protection currently.

**Until proper rate limiting is added:**
- Never log OTP values
- Keep OTP expiry short (Supabase default: 1 hour — should be 10 minutes)
- Monitor for unusual OTP request volumes in Supabase dashboard

---

## Rule 9 — Supabase RLS

Row-Level Security is active on all tables. The anon key is safe to expose in client because:
- `orders` → buyer can only read/write their own (RLS: `buyer_id = auth.uid()`)
- `fish_listings` → public read, seller-only write (RLS: `seller_id = auth.uid()`)
- `sellers` → public read of safe fields, self-only write

**Never disable RLS on any table.**
**Never use the service role key in client-side code.** Service role bypasses RLS entirely.

---

## Rule 10 — CORS + Headers

Already configured in `vercel.json`:

```json
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Robots-Tag: noindex, nofollow  (on app.relifish.store and /api/*)
```

**Do not remove these headers.**

---

## Vulnerability Severity Matrix

| Severity | Examples | Action |
|----------|----------|--------|
| Critical | Auth bypass, payment data exposed, private bucket public | Block merge, fix immediately |
| High | XSS, SQL injection, IDOR (accessing other user's data) | Block merge |
| Medium | Missing input validation, rate limit gap, stale signed URLs | Fix before next release |
| Low | Sensitive field in response (non-critical), missing error logging | Fix in same sprint |

---

## Security Checklist — Every API Route

Before merging any API route, verify:

- [ ] Input validated at boundary (type, format, range)
- [ ] Auth checked before any DB access
- [ ] Seller/buyer only accesses their own resources
- [ ] No `select("*")` — explicit fields only
- [ ] No sensitive fields in response
- [ ] File uploads: MIME type + size + server-generated path
- [ ] Private bucket files: signed URLs only
- [ ] No `seller_id`/`buyer_id` from request body used for access control
- [ ] Error messages don't leak internal structure (`"DB error at line 47"` → `"Something went wrong"`)

---

## Known Vulnerabilities (open)

| ID | Description | Risk | Status |
|----|-------------|------|--------|
| S1 | `buyer_id` from localStorage body used for data access — no session token | Medium (mitigated by RLS) | Open — needs session cookies |
| S2 | No rate limit on `/api/auth/send-otp` | Medium | Open |
| S3 | Payment screenshot TTL not set on signed URLs (default Supabase expiry) | Low | Open |
| S4 | `seller_id` from body in some seller API routes — not verified against auth | Medium | Open — audit in progress |
