# SEO Audit Report — relifish.store
**Date:** 2026-05-11
**Audited URL:** https://relifish.store
**Stack:** Astro 6 + Vercel SSR, Supabase, Mumbai fresh fish marketplace

---

## Executive Summary

### Overall SEO Health Score: 56 / 100

| Category | Weight | Score | Weighted |
|---|---|---|---|
| Content Quality & E-E-A-T | 23% | 51 | 11.7 |
| Technical SEO | 22% | 61 | 13.4 |
| On-Page SEO | 20% | 61 | 12.2 |
| Schema / Structured Data | 10% | 34 | 3.4 |
| Performance (CWV) | 10% | 52 | 5.2 |
| AI Search Readiness (GEO) | 10% | 54 | 5.4 |
| Images | 5% | 85 | 4.3 |
| **Total** | **100%** | | **55.6 → 56** |

### Business Type Detected
**Hyperlocal marketplace / Local Service (B2C e-commerce)** — fresh seafood, Mumbai, India. Buyer-facing marketplace with seller directory, pre-order flow, and WhatsApp-based fulfillment. Target queries: "fresh fish delivery Mumbai", "order pomfret online Mumbai", "fish seller near me Mumbai."

### Top 5 Critical Issues
1. **Google-Extended blocked** — cuts Relifish out of Google AI Overviews (highest-traffic AI search surface)
2. **`/me` and `/track` pages have no `noindex`** — thin app-shell pages indexed, wastes crawl budget
3. **UUID seller URLs** — `/seller/61f02807-…` has zero keyword value; no slug migration in place
4. **`/shop` page absent from sitemap** — the highest-value transactional page is undiscoverable by crawlers
5. **`aggregateRating.reviewCount` uses order count, not review count** — schema violation that could trigger Google manual action

### Top 5 Quick Wins (< 1 hour each)
1. Unblock `Google-Extended` in `public/robots.txt` — 5 minutes, massive AI Overview upside
2. Add `noindex` to `/me`, `/track`, `/track/[id]` — 10 minutes, improves crawl budget
3. Add `/shop` to sitemap — 5 minutes, immediate discoverability gain
4. Create `/public/llms.txt` — 30 minutes, AI citation readiness
5. Expand FAQPage schema from 2 → 7 questions — 45 minutes, AI Overview eligibility

---

## Technical SEO — 61 / 100

### Critical
- **UUID seller URLs** (`/seller/61f02807-15af-4352-bef6-686ae797ea34`) — no keyword signal, not human-readable. Migrate to `/seller/fishy-mart-versova` slugs. Update `sellers` table, sitemap generator (`src/pages/sitemap.xml.ts`), and all JSON-LD `url` references.
- **`/shop` missing from sitemap** — the full marketplace page has no sitemap entry. Add at `priority="0.9"`, `changefreq="daily"`.
- **`/me`, `/track`, `/track/[id]` have no `noindex`** — authenticated app shells get indexed as thin content. Add `<meta name="robots" content="noindex, nofollow">` via an `AppShellV2` prop.

### High
- **No HSTS header** — add `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` to `vercel.json`
- **No CSP header** — add `Content-Security-Policy` covering `self`, Google Fonts, Supabase, inline scripts
- **Google Fonts is render-blocking** — both `index.astro` (line 24) and `AppShellV2.astro` (line 59) use synchronous `<link rel="stylesheet">` for Inter. Switch to async load pattern or self-host via `@fontsource/inter`
- **`app.relifish.store` subdomain not blocked** — the PWA subdomain has no `robots.txt`; add `X-Robots-Tag: noindex` header in `vercel.json` for this host

### Medium
- **`/search` in sitemap but renders empty** — all results load via JS; crawlers see an empty shell. Add `noindex` or remove from sitemap
- **Preorder meta descriptions are 37 characters** — `"Pre-order Surmai for tomorrow's catch"` — expand with location, price range, species name in Marathi
- **Sitemap `lastmod` is always today** — use `updated_at` from DB per entity so Google can trust the signal
- **Seller `openingHours` schema hardcoded to `Mo-Su`** — ignores `open_days` array; incorrect for sellers not open 7 days a week
- **IndexNow key committed in source** — move `INDEXNOW_KEY` to env variable (`import.meta.env.INDEXNOW_KEY`)
- **No `X-Robots-Tag: noindex` on `/api/*`** — defense-in-depth to complement `robots.txt` Disallow

### Low
- `buyer-detailed.html` and `seller-detailed.html` use `.html` extension at `priority: 0.9` — lower priority and consider migrating to clean Astro routes
- Leaflet loaded from `unpkg.com` CDN — self-host for reliability
- OAI-SearchBot not explicitly listed in `robots.txt` (defaults to wildcard Allow but add explicit rule)

---

## Content Quality & E-E-A-T — 51 / 100

| E-E-A-T Dimension | Score |
|---|---|
| Experience | 9/20 |
| Expertise | 12/25 |
| Authoritativeness | 7/25 |
| Trustworthiness | 23/30 |

### Critical
- **No about page / founder identity** — entire site is anonymous. YMYL-adjacent food commerce site with no named team, no business registration, no accountability page. Create `/about` with founder story, seller vetting process, and business address.
- **Hardcoded testimonials with no verification** — six testimonials in `index.astro` are a static array (lines 1229–1240) with no dates, no order IDs, no third-party source. Pull from a real `reviews` table or add a "verified buyer" signal.
- **Preorder species pages are thin content** — `/preorder/pomfret` is a 4-step app wizard with ~200 words, no editorial content about the species. Add a 150-word server-rendered intro block above the wizard.

### High
- **FAQPage schema covers only 2 of 7 FAQ items** — the on-page FAQ (lines 1385–1402) has 7 substantive questions; only 2 are in the JSON-LD schema
- **Organization schema skeleton** — missing `contactPoint`, `sameAs`, `foundingDate`
- **Meta descriptions missing or thin on preorder pages** — `"Pre-order Pomfret for tomorrow's catch"` at 37 chars offers no value
- **Prices hidden behind login on homepage fish grid** — crawlers see "Login to see price"; show indicative price ranges (e.g., "From ₹350/kg")

### Medium
- **Hardcoded stats** — "47 pre-orders placed tonight" is static HTML that never changes; erodes credibility. Wire to live DB counts or use credibly-static phrasing
- **No seller vetting transparency** — add a paragraph explaining how Relifish onboards sellers (FSSAI, quality check, etc.)
- **Homepage word count is ~600-700 words** — adequate but thin for topical depth. Add a "How Mumbai's fish market works" 200-word editorial block
- **Gmail contact address** (`relifishstore@gmail.com`) — signals low business formality. Move to domain email

### Low
- `buyer-detailed.html` and `seller-detailed.html` are static files outside Astro routing — no content management, no schema, hard to update. Migrate to `/buyer-guide` and `/seller-guide` Astro routes.
- No GST number or FSSAI food safety license displayed — standard for Indian food commerce

---

## On-Page SEO — 61 / 100

### Critical
- **Preorder page headings are step labels** — H2s say "Step 1 · Pick a seller", not keywords. Google sees near-zero on-page relevance for "order pomfret Mumbai" beyond the title tag.

### High
- **Fish species not in any heading or linked text** — on the homepage, fish names (Pomfret, Surmai, Bangda) appear only as `<span class="ftag">` emoji chips with no H2/H3, no anchor text. Add an H2 like "Order Fresh Mumbai Fish Online" and H3s per species linking to `/preorder/[species]`
- **Seller meta descriptions use hardcoded species list** — description always lists "pomfret, surmai, bangda, prawns" regardless of what the seller actually stocks. Build dynamically from `seoListings`
- **UUID seller URLs** — also an on-page issue (no keyword in URL = no URL-based ranking signal)

### Medium
- **Homepage heading hierarchy** — H1 → H2 is structurally fine but some H2s ("Everything you need to get started") could be more keyword-rich
- **Fish card links lack descriptive anchor text** — `<a class="fish-cta">` likely reads "Pre-order" without species name. Use "Pre-order Pomfret", "Order Surmai online" etc.
- **No `twitter:title` or `twitter:description`** on homepage (AppShellV2 has it; `index.astro` doesn't)

### Low
- Canonical consistency: `relifish.store` → `www.relifish.store` 301 is handled by Vercel. Verify in production.
- `/og-image.png` referenced in meta but existence in `/public` unverified

---

## Schema / Structured Data — 34 / 100

| Page | Schema Present | Score |
|---|---|---|
| Homepage | Organization, WebSite, FAQPage | 17/35 |
| Seller page | FoodEstablishment, ItemList, Product | 14/35 |
| Preorder page | None | 0/15 |
| buyer-detailed.html | None | 0/10 |
| BreadcrumbList (any page) | None | 0/5 |

### Critical
- **`aggregateRating.reviewCount` uses `total_orders`** — in `src/pages/seller/[id].astro` lines 141–181, `reviewCount` is populated with order count, not review count. Schema.org requires written review count. This is a policy violation that risks a Google manual action. Either source from a real `reviews` table or remove the `aggregateRating` block.
- **SearchAction missing from WebSite schema** — `/api/search` exists but is not wired up in the WebSite JSON-LD. The `potentialAction` SearchAction is a free Sitelinks Searchbox rich result.

### High
- **No BreadcrumbList on any page** — seller pages and preorder pages both lack it. BreadcrumbList is consistently supported and improves SERP display.
- **No schema on preorder pages** — zero structured data on `/preorder/[species]`. Add `Product` + `AggregateOffer` + `ItemList` of available sellers.

### Medium
- **`FoodEstablishment` missing `geo` coordinates** — check if `lat`/`lng` exist in the `sellers` table; add to schema for Maps association
- **`Product.offers.availability` hardcoded to `InStock`** — pre-order items should use `PreOrder`
- **Only 2 FAQ items in FAQPage schema** — expand to 6-8 questions matching real user queries

### Generated JSON-LD (Critical Fixes)

**Fix 1: WebSite SearchAction (homepage)**
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

**Fix 2: Preorder page Product schema**
```json
{
  "@type": "Product",
  "name": "Fresh Pomfret — Pre-order",
  "description": "Pre-order fresh Pomfret (पापलेट) for tomorrow's catch from local Mumbai fish sellers.",
  "category": "Seafood",
  "brand": { "@type": "Brand", "name": "Relifish" },
  "offers": {
    "@type": "AggregateOffer",
    "priceCurrency": "INR",
    "lowPrice": "300",
    "highPrice": "500",
    "offerCount": "[SELLER_COUNT]",
    "availability": "https://schema.org/PreOrder"
  }
}
```

---

## Performance (Core Web Vitals) — 52 / 100

| Metric | Estimated | Status |
|---|---|---|
| LCP | ~2.8–3.5s | Needs Improvement |
| INP | ~80–120ms | Good |
| CLS | ~0.05–0.12 | Borderline |

*Lab estimates from source analysis. Run CrUX field data for confirmation.*

### P0 — Render-blocking Google Fonts (LCP impact: 300–600ms on Indian 4G)
Both `index.astro` (line 24) and `AppShellV2.astro` (line 59) use synchronous Google Fonts `<link rel="stylesheet">`. Inter loads 6 weight variants (400–900), 2 are unnecessary (500, 900). The LCP element (hero H1) depends on Inter loading.

**Fix options (pick one):**
1. **Self-host** via `@fontsource/inter` — install the package, import in a global CSS file, remove Google Fonts links entirely. Served from Vercel CDN, eliminates external round-trip.
2. **Non-blocking load pattern:**
```html
<link rel="preload" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" as="style" onload="this.onload=null;this.rel='stylesheet'" />
<noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" /></noscript>
```

### P1 — Trim font weights from 6 to 4
Only 400/600/700/800 are needed. Remove 500 and 900. Saves ~60KB.

### P2 — Seller page cart re-render replaces full DOM subtree
In `src/pages/seller/[id].astro`, `render()` does `grid.innerHTML = ...` on every cart add/remove. With 10+ listings this may push INP above 200ms on mid-range devices. Switch to incremental DOM updates targeting only changed quantity badges.

### P3 — rAF loop on phone demo doesn't pause when tab is hidden
In `index.astro` (the landing page phone demo), the progress bar uses a continuous `requestAnimationFrame` loop that runs even when `document.visibilityState === 'hidden'`. Add a `visibilitychange` listener to pause the loop.

### P4 — Leaflet from unpkg CDN
Pages with `needsMap={true}` load Leaflet from `https://unpkg.com` — a third-party single point of failure. Install locally: `npm install leaflet` and import directly.

---

## AI Search Readiness (GEO) — 54 / 100

| Platform | Score | Bottleneck |
|---|---|---|
| Google AI Overviews | 38/100 | Google-Extended blocked; weak prose passages |
| Perplexity | 67/100 | Bot allowed; FAQ schema helps |
| ChatGPT (browsing) | 61/100 | Bot allowed; brand mentions weak |
| Claude (Anthropic) | 70/100 | Bot allowed; seller schema strong |
| Bing Copilot | 52/100 | No explicit Bing AI rules |

### Critical
- **Google-Extended is blocked** in `public/robots.txt`. This blocks both Gemini training AND Google AI Overviews. Change `Disallow: /` to `Allow: /` under `User-agent: Google-Extended`. Single highest-impact change on the site.
- **No `llms.txt`** — the emerging AI site map standard. Create at `public/llms.txt` (see template below).

### High
- **No extractable prose paragraph** — no page contains a self-contained 40-160 word passage answering "what is Relifish." The content exists in comparison grids and bullet lists — structurally weak for AI passage extraction. Add: *"Relifish is a Mumbai fish marketplace connecting buyers directly to local fish sellers — no middlemen, no markup. Buyers browse seller menus, compare prices, and pre-order species like surmai, pomfret, rawas, and bangda. Orders are available same-day or next morning. Currently serving Versova and Andheri West."*
- **FAQPage schema only covers 2 of 7 questions** — AI Overviews preferentially pull from FAQ schema. Expand to cover real user queries (see Content section).

### Medium
- **OAI-SearchBot not explicitly listed** — add `User-agent: OAI-SearchBot / Allow: /` to robots.txt
- **Zero off-page brand signals** — no Reddit, no YouTube, no press. YouTube correlation with AI citations is 0.737. A single "How to order fish on Relifish" YouTube video is worth more than most on-page changes.

**Recommended `public/llms.txt`:**
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
- Pricing: Direct seller pricing, no Swiggy/Zomato-style markup
- Contact: relifishstore@gmail.com
```

---

## Images — 85 / 100

Homepage uses zero `<img>` tags — all visuals are CSS, emoji, or SVG. No alt text violations. No oversized images. Minor gap: OG image (`/og-image.png`) existence in `/public` unverified. Seller pages use real product photos via Supabase Storage URLs — ensure these have descriptive alt text (seller name + species).

---

## Sitemap Analysis

**20 URLs indexed. Coverage gaps:**

| Missing Page | Priority | Impact |
|---|---|---|
| /shop | Critical | Highest-value transactional page |
| /seller-detailed.html | Present | OK |
| /buyer-detailed.html | Present | OK |
| /me, /track | Should be excluded | Currently indexed as thin content |
| /search | Should be excluded | Empty shell for crawlers |
| /privacy | Missing | Low impact |
| /about | Missing | Needs to be created |

---

## robots.txt Assessment

**What's right:**
- Blocks `/dashboard/` and `/api/` correctly
- Allows ClaudeBot, PerplexityBot, ChatGPT-User
- Declares sitemap location

**What's wrong:**
- `Google-Extended: Disallow /` — blocks AI Overviews (see GEO section)
- No `OAI-SearchBot` explicit rule
- Sitemap URL uses `www` but file is served dynamically via Astro SSR — verify it actually resolves

---

## File Paths for Fixes

| Fix | File |
|---|---|
| noindex on auth pages | `src/pages/me.astro`, `src/pages/track.astro`, `src/components/v2/AppShellV2.astro` |
| sitemap: add /shop, remove /search | `src/pages/sitemap.xml.ts` |
| seller slug migration | `src/pages/seller/[id].astro`, `src/pages/sitemap.xml.ts`, `supabase sellers table` |
| robots.txt: unblock Google-Extended, add OAI-SearchBot | `public/robots.txt` |
| llms.txt | `public/llms.txt` (create) |
| schema: SearchAction | `src/pages/index.astro` (lines 29-30) |
| schema: fix reviewCount | `src/pages/seller/[id].astro` (lines 141-181) |
| schema: preorder pages | `src/pages/preorder/[species].astro` |
| schema: BreadcrumbList | `src/pages/seller/[id].astro`, `src/pages/preorder/[species].astro` |
| FAQPage: expand to 7 items | `src/pages/index.astro` (lines 31-34) |
| Font: self-host Inter | `src/components/v2/AppShellV2.astro` (line 59), `src/pages/index.astro` (line 24) |
| Font: trim weights | Same files |
| Meta descriptions: preorder pages | `src/pages/preorder/[species].astro` (line 56) |
| Citable prose paragraph | `src/pages/index.astro`, `public/buyer-detailed.html` |
| HSTS + CSP headers | `vercel.json` |
| app.relifish.store noindex | `vercel.json` |
| openingHours fix | `src/pages/seller/[id].astro` |
| About page | Create `src/pages/about.astro` |
| IndexNow key to env var | `src/pages/api/indexnow.ts` (line 3) |
