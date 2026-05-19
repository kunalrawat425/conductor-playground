# Relifish — Coding Standards

> These are the rules. Every PR is checked against them via `/review`.
> Violations block merge. No exceptions without a written reason in the PR body.

---

## 1. DRY — Don't Repeat Yourself

### Rule
Every piece of logic has exactly one home. If it needs to change, you change it in one place.

### Violations that will be caught

```typescript
// ❌ WRONG — inline timing logic anywhere outside order-timing.ts
const cur = new Date().getHours() * 60 + new Date().getMinutes();
if (cur >= openMin && cur <= closeMin) ...

// ✅ RIGHT — import and use
import { isSellerEffectivelyOpen } from "@/lib/order-timing";
if (isSellerEffectivelyOpen(seller)) ...
```

```typescript
// ❌ WRONG — same validation in two API routes
if (!phone.match(/^[6-9]\d{9}$/)) return error(400, "invalid phone");

// ✅ RIGHT — shared validator
import { validateIndianPhone } from "@/lib/indian-phone";
```

### Where each domain lives (single source of truth)

| Domain | File | Rule |
|--------|------|------|
| Seller open/closed/preorder timing | `src/lib/order-timing.ts` | No inline timing anywhere else |
| Cart state + mutations | `src/lib/cart.ts` | No direct localStorage `relifish_cart_v2` access outside this file |
| Listing price options | `src/lib/listing-pricing.ts` | No inline price parsing |
| Species display names | `src/lib/species.ts` | No hardcoded species strings |
| IST formatting | `src/lib/format-ist.ts` | No `toLocaleString("en-IN")` calls outside this file |
| Email templates | `src/lib/email-templates.ts` | No inline HTML email strings |
| Seller auth | `src/lib/seller-auth.ts` | No direct `localStorage.getItem("rlf_seller_id")` in pages |
| Push notifications | `src/lib/push.ts` + `src/lib/seller-push.ts` | No direct VAPID/push logic in API routes |
| Supabase client | `src/lib/supabase.ts` | One client instance, never `createClient()` in a page |
| Site origin / absolute URLs | `src/lib/server/site-origin.ts` | No hardcoded `https://relifish.store` strings |

---

## 2. Timezone — IST Everywhere

### Rule
All time computation uses IST (UTC+5:30). Server runs UTC. Browser may be any timezone. Never trust either.

### The pattern

```typescript
// ✅ Server-side — always use order-timing.ts
import { minutesNowIST, todayDayName } from "@/lib/order-timing";

// ✅ Client-side (when order-timing.ts is not importable)
function minutesNowIST(): number {
  const nowIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return nowIST.getUTCHours() * 60 + nowIST.getUTCMinutes();
}
function todayDayNameIST(): string {
  const nowIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return ["sun","mon","tue","wed","thu","fri","sat"][nowIST.getUTCDay()];
}
```

### Violations

```typescript
// ❌ WRONG — server local time (UTC on Vercel)
new Date().getHours()
new Date().getDay()
d.getDay()

// ❌ WRONG — browser local time
new Date().getHours()
new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
// (this works in browser but is wrong on server — not portable)

// ✅ RIGHT — always IST via offset
const nowIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
nowIST.getUTCHours() // ← UTCHours on IST-offset date = IST hours
nowIST.getUTCDay()   // ← UTCDay on IST-offset date = IST day
```

### Time range boundary

```typescript
// ❌ WRONG — inclusive close (cur <= closeMin) includes the exact closing minute
if (cur >= openMin && cur <= closeMin)

// ✅ RIGHT — exclusive close (cur < closeMin)
if (cur >= openMin && cur < closeMin)
// Matches order-timing.ts isSellerOpenByClock line 41
```

---

## 3. API Design

### Every API route must

1. **Validate all inputs at the boundary** — never trust client data
2. **Return typed errors** — `{ error: string }` with correct HTTP status
3. **Check auth before any DB query** — session first, data second
4. **Select explicit fields** — never `select("*")` in production paths
5. **Set `export const prerender = false`** — all API routes are SSR

### Input validation pattern

```typescript
// ✅ CORRECT API route structure
export const POST: APIRoute = async ({ request }) => {
  // 1. Parse + validate input
  const body = await request.json().catch(() => null);
  if (!body?.seller_id || typeof body.seller_id !== "string") {
    return new Response(JSON.stringify({ error: "seller_id required" }), { status: 400 });
  }

  // 2. Auth check
  const buyerId = body.buyer_id; // from session cookie or header — NEVER from body for identity
  if (!buyerId) return new Response(JSON.stringify({ error: "Unauthorised" }), { status: 401 });

  // 3. DB query with explicit fields
  const { data, error } = await supabase
    .from("sellers")
    .select("id, name, opens_at, closes_at, is_active")
    .eq("id", body.seller_id)
    .single();

  if (error || !data) return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  if (!data.is_active) return new Response(JSON.stringify({ error: "Seller inactive" }), { status: 403 });

  // 4. Business logic
  // ...

  return new Response(JSON.stringify({ success: true }), { status: 200 });
};
```

### HTTP status codes

| Situation | Status |
|-----------|--------|
| Missing / invalid input | 400 |
| Not authenticated | 401 |
| Authenticated but not allowed | 403 |
| Resource not found | 404 |
| Business rule violated (closed seller, past cutoff) | 400 with readable `error` string |
| Server error | 500 |

---

## 4. TypeScript

### Rules

- No `any` in new code — use `unknown` and narrow it
- All function parameters typed — no implicit `any`
- All API response shapes typed — define an interface, not inline object
- Null-check before use — no `!` non-null assertions on data from DB or API
- Prefer `interface` for object shapes, `type` for unions and aliases

```typescript
// ❌ WRONG
function processOrder(order: any) { ... }
const name = seller!.name;

// ✅ RIGHT
function processOrder(order: Order) { ... }
const name = seller?.name ?? "Unknown Seller";
```

---

## 5. Error Handling

### Rule
Never swallow errors silently. Every `catch` block must do something observable.

```typescript
// ❌ WRONG — silent failure
try {
  seller = await getSellerById(id);
} catch { notFound = true; }

// ✅ RIGHT — log + typed response
try {
  seller = await getSellerById(id);
} catch (err) {
  console.error("[seller/[id]]", err);
  return Astro.redirect("/shop", 302);
}
```

### Error categories

| Category | Pattern |
|----------|---------|
| Validation failure | Return 400 immediately, no throw |
| Not found | Return 404 immediately, no throw |
| Business rule | Return 400 with `closedSellerMessage()` or equivalent |
| Unexpected DB error | Log to console, return 500 |
| Network/timeout | Retry once, then 503 |

---

## 6. Naming Conventions

| Thing | Convention | Example |
|-------|-----------|---------|
| localStorage keys | `rlf_` prefix | `rlf_buyer_id`, `rlf_seller_id` |
| sessionStorage keys | `rf_` prefix | `rf_utm_source`, `rf_utm_medium` |
| GA4 custom events | `snake_case` | `utm_landing`, `add_to_cart` |
| CSS classes (buyer UI) | `v2-` prefix | `v2-btn`, `v2-badge` |
| CSS classes (demo phone) | `d{N}-` prefix | `d1-btn`, `d3-bar` |
| API routes | `kebab-case` file names | `create-seller-cart.ts` |
| Lib functions | `camelCase` verbs | `isSellerEffectivelyOpen`, `formatBuyerMenuUnitSuffix` |
| Types/interfaces | `PascalCase` | `SellerTimingInput`, `CartItem` |
| DB columns | `snake_case` | `opens_at`, `store_image_url` |

---

## 7. Frontend — No Business Logic in Components

### Rule
Pages and components render data. They do not compute it.

```typescript
// ❌ WRONG — business logic in a .astro template
{seller.opens_at && new Date().getHours() >= parseInt(seller.opens_at) ? "Open" : "Closed"}

// ✅ RIGHT — computed in frontmatter or lib, rendered in template
// Frontmatter:
const status = classifyPlacementAtOrderTime(seller);
// Template:
{status === "same_day" ? "Open" : status === "preorder" ? "Pre-orders open" : "Closed"}
```

---

## 8. Commit Messages

```
<type>: <what changed and why>

Types: feat | fix | chore | refactor | docs | test
```

```
# ✅ Good
fix: shop badge uses preorderMode not preorderAvailableToday — cutoff was ignored
feat: add utm_landing GA4 event for flyer attribution

# ❌ Bad
fix: bug fix
update: changes
```

---

## Enforcement

Every PR runs `/review` which checks all of the above automatically.
Findings are classified `AUTO-FIX` (fixed inline) or `ASK` (requires your decision).
No merge until all `ASK` items are resolved.
