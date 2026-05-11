# SEO Action Plan — relifish.store
**Audit date:** 2026-05-11 | **Overall score: 56/100**

---

## CRITICAL — Fix immediately (< 1 day, massive impact)

### 1. Unblock Google-Extended in robots.txt
**File:** `public/robots.txt`
**Time:** 5 minutes

Change:
```
User-agent: Google-Extended
Disallow: /
```
To:
```
User-agent: Google-Extended
Allow: /
```
**Why:** This single line blocks Relifish from appearing in Google AI Overviews. The intent was to block training data, but it also blocks AI Overview indexing — the highest-traffic AI search surface for "fresh fish delivery Mumbai" queries.

---

### 2. Add noindex to auth/app pages
**File:** `src/components/v2/AppShellV2.astro`
**Time:** 15 minutes

Add a `noindex` prop:
```astro
---
const { noindex = false } = Astro.props;
---
{noindex && <meta name="robots" content="noindex, nofollow" />}
```

Then pass `noindex={true}` on: `src/pages/me.astro`, `src/pages/track.astro`, `src/pages/track/[id].astro`

Also add to `public/robots.txt`:
```
Disallow: /me
Disallow: /track
```

---

### 3. Add /shop to sitemap
**File:** `src/pages/sitemap.xml.ts`
**Time:** 5 minutes

Add to the `urls` array:
```ts
{ loc: "/shop", changefreq: "daily", priority: "0.9" },
```
The `/shop` page is the full marketplace — highest-value transactional page — and is currently invisible to crawlers.

---

### 4. Fix aggregateRating.reviewCount on seller pages
**File:** `src/pages/seller/[id].astro` (lines 141–181)
**Time:** 30 minutes

`reviewCount` is currently populated with `total_orders`. This is a schema violation. Options:
- **Option A (recommended):** Remove `aggregateRating` block entirely until a real `reviews` table exists
- **Option B:** Create a `reviews` table, add a count query, use real count
- **Option C (temporary):** Rename to `ratingCount` and add a note that it represents order-based ratings

Using order count as review count risks a Google manual action for misleading structured data.

---

## HIGH — Fix within 1 week

### 5. Create /public/llms.txt
**Time:** 30 minutes

```
# Relifish — Mumbai Fresh Fish Marketplace
# https://www.relifish.store

> Relifish connects Mumbai fish buyers directly to local sellers. Browse real-time
> menus, compare prices, and pre-order species like surmai, pomfret, rawas, bangda,
> and prawns for same-day or next-morning pickup. No middlemen. No platform markup.
> Currently serving Versova and Andheri West, expanding across Mumbai.

## Key Pages
- [How it works for buyers](https://www.relifish.store/buyer-detailed.html)
- [Browse sellers](https://www.relifish.store/shop)
- [Pre-order fish](https://www.relifish.store/preorder)
- [Privacy Policy](https://www.relifish.store/privacy)

## About
- Platform: Fish marketplace / hyperlocal commerce
- Geography: Mumbai, India
- Order types: Same-day pickup, pre-order (next-morning confirmation)
- Species: Surmai, Pomfret, Rawas, Bangda, Prawns, Bombay Duck, Crab
- Pricing: Direct seller pricing, no platform markup
- Contact: relifishstore@gmail.com
```

---

### 6. Expand FAQPage schema from 2 → 7 questions
**File:** `src/pages/index.astro` (lines 31–34)
**Time:** 45 minutes

Add 5 more entries covering real user queries:
- "Can I pre-order fish online in Mumbai?" — describe pre-order flow explicitly naming Relifish
- "What fish species are available on Relifish?" — list surmai, pomfret, rawas, bangda, prawns, bombil, crab
- "How fresh is the fish on Relifish?" — reference same-day catch, no cold storage
- "What areas in Mumbai does Relifish serve?" — Versova, Andheri West + expansion note
- "How does fish pricing work on Relifish?" — direct seller pricing, no platform markup

Each answer should be 40–80 words and name "Relifish" in the answer text, not just the question.

---

### 7. Add citable prose paragraph to homepage and buyer page
**Files:** `src/pages/index.astro`, `public/buyer-detailed.html`
**Time:** 30 minutes

Add as visible `<p>` tag early on both pages:

> "Relifish is a Mumbai fish marketplace that connects buyers directly to local fish sellers — no middlemen, no markup. Buyers browse seller menus updated daily, compare prices across multiple sellers, and pre-order species like surmai, pomfret, rawas, bangda, and prawns. Orders are available for same-day pickup or pre-order with next-morning seller confirmation. Relifish currently serves Versova and Andheri West, with ongoing expansion across Mumbai."

This 74-word passage is the primary AI citation candidate for every major search engine.

---

### 8. Self-host Inter font — remove render-blocking Google Fonts
**Files:** `src/components/v2/AppShellV2.astro` (line 59), `src/pages/index.astro` (line 24)
**Time:** 45 minutes

```bash
npm install @fontsource/inter
```

In a shared CSS file:
```css
@import '@fontsource/inter/400.css';
@import '@fontsource/inter/600.css';
@import '@fontsource/inter/700.css';
@import '@fontsource/inter/800.css';
```

Remove all 3 Google Fonts `<link>` tags from both files. **Expected impact: LCP improvement of 300–600ms on Indian 4G connections.**

---

### 9. Add HSTS and CSP to vercel.json
**File:** `vercel.json`
**Time:** 20 minutes

Add to the global headers block:
```json
{ "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains; preload" },
{ "key": "Content-Security-Policy", "value": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: https:; connect-src 'self' https://*.supabase.co" }
```

Note: Adjust `font-src` directive based on whether Google Fonts is still used or self-hosted.

---

### 10. Add SearchAction to WebSite schema
**File:** `src/pages/index.astro` (line 30)
**Time:** 15 minutes

Replace the bare WebSite node with:
```json
{
  "@type": "WebSite",
  "@id": "https://www.relifish.store/#web",
  "name": "Relifish",
  "url": "https://www.relifish.store",
  "potentialAction": {
    "@type": "SearchAction",
    "target": {
      "@type": "EntryPoint",
      "urlTemplate": "https://www.relifish.store/search?q={search_term_string}"
    },
    "query-input": "required name=search_term_string"
  }
}
```

---

### 11. Block app.relifish.store subdomain from indexing
**File:** `vercel.json`
**Time:** 15 minutes

Add a host-matched route:
```json
{
  "source": "/(.*)",
  "has": [{ "type": "host", "value": "app.relifish.store" }],
  "headers": [{ "key": "X-Robots-Tag", "value": "noindex, nofollow" }]
}
```

---

### 12. Create About page
**File:** Create `src/pages/about.astro`
**Time:** 2 hours

Include: named founders/team, founding story, how sellers are vetted, business address (even area-level), FSSAI context, and why Relifish was built. Link from footer. This is the single biggest E-E-A-T gap on the site.

---

## MEDIUM — Fix within 1 month

### 13. Add content blocks to preorder species pages
**File:** `src/pages/preorder/[species].astro`
**Time:** 2 hours

Add a server-rendered `<section>` above the wizard with species-specific content:
```astro
<section class="species-intro">
  <h1>Pre-order fresh {sp.en} ({sp.mr}) in Mumbai</h1>
  <p>Order {sp.en} tonight from local Mumbai sellers in Versova and Andheri West.
  Morning-fresh from the catch — no cold storage. Confirm by 10 PM, collect tomorrow morning.</p>
  <p>Typical price range: ₹{minPrice}–₹{maxPrice}/kg across {sellerCount} sellers.</p>
</section>
```

Use live data from the existing `sellers` query. ~150 words per species page transforms thin wizard pages into crawlable content.

---

### 14. Add BreadcrumbList schema to seller and preorder pages
**Files:** `src/pages/seller/[id].astro`, `src/pages/preorder/[species].astro`
**Time:** 1 hour

Add to the JSON-LD graph on each page type. Example for seller page:
```json
{
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.relifish.store/" },
    { "@type": "ListItem", "position": 2, "name": "SELLER_NAME", "item": "https://www.relifish.store/seller/SELLER_SLUG" }
  ]
}
```

---

### 15. Add geo coordinates to seller FoodEstablishment schema
**File:** `src/pages/seller/[id].astro`
**Time:** 30 minutes

Check if `lat`/`lng` columns exist in `sellers` table. Add to the `select` query and include in JSON-LD:
```json
"geo": {
  "@type": "GeoCoordinates",
  "latitude": "seller.lat",
  "longitude": "seller.lng"
}
```

---

### 16. Fix seller openingHours schema
**File:** `src/pages/seller/[id].astro`
**Time:** 30 minutes

Current code hardcodes `Mo-Su`. Use actual `open_days` array:
```ts
const dayMap = ["Su","Mo","Tu","We","Th","Fr","Sa"];
const openDaysStr = seller.open_days.map(d => dayMap[d]).join(",");
// Result: "Mo,Tu,We,Th,Fr,Sa 17:00-06:00"
```

---

### 17. Fix preorder page meta descriptions
**File:** `src/pages/preorder/[species].astro` (line 56)
**Time:** 20 minutes

Replace 37-char generic description with:
```astro
description={`Pre-order fresh ${sp.en} (${sp.mr}) from Mumbai fish sellers. Reserve tonight, collect morning-fresh tomorrow. Versova and Andheri West. No cold storage, no markup — direct from source.`}
```

---

### 18. Make homepage stats live
**File:** `src/pages/index.astro` (lines 710, 1264)
**Time:** 2 hours

"47 pre-orders placed in Mumbai tonight" and "200+ buyers on the waitlist" are hardcoded. Either:
- Query live counts from Supabase in the SSR frontmatter and render dynamically
- Or replace with static but credibly-specific non-time-sensitive claims

---

### 19. Seller slug migration
**Files:** `src/pages/seller/[id].astro`, `src/pages/sitemap.xml.ts`, Supabase `sellers` table
**Time:** 1 day (includes migration + redirect setup)

1. Add `slug` column to `sellers` table (e.g., `fishy-mart-versova`)
2. Create new route `src/pages/seller/[slug].astro`
3. Keep `[id].astro` as a permanent 301 redirect to the slug URL
4. Update sitemap generator to use `slug`
5. Update all JSON-LD `url` and `@id` references

---

### 20. Add OAI-SearchBot to robots.txt
**File:** `public/robots.txt`
**Time:** 5 minutes

```
User-agent: OAI-SearchBot
Allow: /
```

---

### 21. Improve fish grid section on homepage
**File:** `src/pages/index.astro`
**Time:** 1 hour

- Add H2: "Order Fresh Mumbai Fish Online"
- Give each fish card an H3 with the species name
- Make CTAs descriptive: "Pre-order Pomfret" not just "Pre-order"
- Link each card to `/preorder/[species]`

---

## LOW — Backlog

| # | Action | File | Time |
|---|---|---|---|
| 22 | Move IndexNow key to env var | `src/pages/api/indexnow.ts` line 3 | 10 min |
| 23 | Self-host Leaflet (remove unpkg CDN) | `AppShellV2.astro` lines 77-78 | 30 min |
| 24 | Fix sitemap lastmod to use DB timestamps | `src/pages/sitemap.xml.ts` | 45 min |
| 25 | Add `twitter:title`/`twitter:description` to homepage | `src/pages/index.astro` | 10 min |
| 26 | Add `X-Robots-Tag: noindex` to /api/* responses | `vercel.json` | 10 min |
| 27 | Lower buyer/seller-detailed.html priority from 0.9 to 0.6 | `src/pages/sitemap.xml.ts` | 5 min |
| 28 | Verify `/og-image.png` exists in `/public` | `public/` | 5 min |
| 29 | Pause phone demo rAF loop on visibilitychange | `src/pages/index.astro` | 20 min |
| 30 | Add YouTube video: "How to order fish on Relifish" | Off-site | 1 day |
| 31 | Submit to HSTS preload list (after HSTS deployed) | https://hstspreload.org | 5 min |
| 32 | Move to domain email (hello@relifish.store) | Google Workspace/Zoho | 1 hour |
| 33 | Add FSSAI / GST display to footer or about page | `src/pages/about.astro` | 30 min |
| 34 | Migrate buyer-detailed.html to Astro route /buyer-guide | `src/pages/` | 2 hours |
| 35 | Add `geo` coordinates to seller schema | `src/pages/seller/[id].astro` | 30 min |

---

## Estimated Score After Critical + High Fixes

| Category | Current | After Fixes |
|---|---|---|
| Technical SEO | 61 | 78 |
| Content Quality | 51 | 64 |
| On-Page SEO | 61 | 72 |
| Schema | 34 | 58 |
| Performance | 52 | 72 |
| AI Search Readiness | 54 | 76 |
| Images | 85 | 85 |
| **Overall** | **56** | **72** |
