# Landing Page Audit — relifish.store

**Date:** 2026-04-15
**URL:** https://relifish.store
**Purpose:** Ad landing page readiness for pre-seed fundraising + future paid acquisition

---

## Landing Page Health Score

```
Message Match:    ████████░░  75/100
Page Speed:       ███████░░░  70/100
Mobile:           █████████░  88/100
Trust Signals:    ████░░░░░░  40/100
Form Quality:     ███████░░░  72/100
─────────────────────────────────
OVERALL:          ██████░░░░  68/100  (Grade: C+)
```

**Verdict:** Solid mobile-first UI, good product clarity, but **weak trust signals** and **no conversion tracking** kill ad ROI before it starts. Fix 5 things before running any paid traffic.

---

## 1. Message Match — 75/100

### What's Good
- **Clear value prop**: "Fresh Fish, Delivered Fast" in title tag
- **H1 is SEO-appropriate**: "Fresh Fish from Local Mumbai Sellers"
- **Benefit cards** clearly explain the offering (freshness, transparent pricing, pre-order, nearby sellers)
- **How it works** 4-step flow is immediately understandable

### Issues
| Issue | Impact | Fix |
|-------|--------|-----|
| **No visible H1 on page** — it's `sr-only` (screen-reader only) | Buyer lands on page, sees search bar first, no headline | Make H1 visible. "Fresh fish from sellers near you" above search |
| **"Mumbai" hardcoded** but product is in Goa | Confusing for Goa-targeted ads | Change to dynamic location or "Goa" |
| **Hero has no hero image/visual** | Page looks like a utility, not a marketplace | Add a hero image (fresh fish photo) above the search bar |
| **Empty state is the default experience** | "No sellers in your area yet" is what most visitors see | If targeting ads to areas with sellers, deep-link to seller page instead |

### Message Match for Ad Scenarios
| Ad Copy | Landing Experience | Match |
|---------|--------------------|-------|
| "Fresh fish delivered in Goa" | Page says "Mumbai" throughout | **Mismatch** |
| "Order from local fishermen" | Seller cards show when nearby | **Partial** (requires location) |
| "Pre-order tomorrow's catch" | Pre-order chip exists but buried | **Weak** |

---

## 2. Page Speed — 70/100

### Measured Elements (Code-Level)
| Factor | Status | Notes |
|--------|--------|-------|
| **SSR** (Astro) | PASS | Server-rendered, fast TTFB |
| **Leaflet CSS** loaded on every page | WARNING | External CDN dependency, render-blocking |
| **No image optimization** | WARNING | No `<img>` with width/height, no lazy loading visible |
| **Service Worker** registered | PASS | sw.js present for PWA caching |
| **Vercel edge deployment** | PASS | Good CDN coverage |
| **Skeleton loaders** | PASS | Good perceived performance |
| **No font preloading** | WARNING | System font stack used (good), but no `font-display: swap` needed |

### Estimated Impact
- Leaflet CSS loaded even when map isn't visible = ~100KB unnecessary on homepage for most users
- No image lazy loading = potential CLS on seller cards with photos
- Supabase JS client loaded for all pages = large JS bundle

---

## 3. Mobile Experience — 88/100

### What's Good
- **Viewport meta** correct with `viewport-fit=cover`
- **PWA manifest** present with standalone display
- **Apple mobile web app** meta tags set
- **Touch-friendly** chips, buttons, form inputs
- **Bottom nav** (3 tabs) with proper safe area padding
- **No horizontal scroll** — layout is mobile-first
- **Form inputs** properly sized at 15px font (iOS won't auto-zoom)
- **Search input** full-width, easy to tap

### Issues
| Issue | Impact | Fix |
|-------|--------|-----|
| **CTA not visible without scrolling** | First screen = search bar + chips + loading skeleton | Move primary CTA (browse sellers / join waitlist) above fold |
| **Chip overflow** on small screens | 6 filter chips overflow horizontally | Fine for scroll, but first-time user may miss "Delivery" chip |
| **No tel: links** for contact email | Phone users can't tap to call | Add phone number with `tel:` link |
| **og-image.png** path set but file may not be optimized | Social sharing preview could be broken | Verify OG image exists at `/og-image.png` and is 1200x630 |

---

## 4. Trust Signals — 40/100 ⚠️ CRITICAL

This is the **biggest gap**. Ad traffic has zero brand trust. They need to trust you in 3 seconds.

### Above-the-Fold Trust
| Signal | Present? | Notes |
|--------|----------|-------|
| Company logo | NO | Only text "Relifish" in header |
| Customer count / social proof | NO | Nothing above fold |
| Star ratings | NO | No ratings visible |
| Security badges | NO | No SSL badge, payment guarantee |
| Testimonials | NO | None anywhere on page |
| "As seen in" / press | NO | N/A at this stage |

### Below-the-Fold Trust
| Signal | Present? | Notes |
|--------|----------|-------|
| Fake social proof avatars | YES | "RK, PS, AM, +" with "Mumbai buyers are joining every day" — **REMOVE THIS** |
| Email contact | YES | relifishstore@gmail.com |
| Physical address | NO | No address shown |
| Privacy policy | NO | None linked |

### Critical Fixes
1. **Remove fake avatar social proof** — "RK, PS, AM, +" with hardcoded initials looks fabricated. Destroys trust. Either show real numbers from Supabase or remove entirely.
2. **Add a real logo** — even a simple wordmark SVG. Text-only header looks unfinished.
3. **Add privacy policy** — required by Google Ads and Meta Ads policies. No privacy policy = ad account suspension risk.
4. **Add physical location** — "Based in Goa, India" in footer builds local trust.
5. **Gmail address** — relifishstore@gmail.com looks amateur. Get contact@relifish.store (free with Zoho or Cloudflare email routing).

---

## 5. Form Quality — 72/100

### Waitlist Form Analysis
| Field | Required? | Type | Notes |
|-------|-----------|------|-------|
| Phone | Yes | `tel` | Good — matches India audience |
| Email | No | `email` | Good — optional reduces friction |
| Area | Yes | `text` | Good — useful for geo planning |
| Frequency | No | chips | Good — qualifying data |
| Preference | No | chips | Good — qualifying data |
| Budget | No | chips | Good — qualifying data |
| Fish request | No | `text` | Nice touch for specificity |
| **Total fields** | **7** | | **Too many for a waitlist** |

### Issues
| Issue | Impact | Fix |
|-------|--------|-----|
| **7 fields for a waitlist** is too many | Expected CVR drop vs 3-field form | Move qualifying Qs to a follow-up (post-signup) |
| **Submit button "Notify Me When Live"** is good | Clear CTA | Keep |
| **No inline validation** | Errors only on submit | Add real-time validation for phone format |
| **No multi-step** for 7 fields | Wall of fields on mobile | If keeping all fields, use 2-step: contact → preferences |
| **Success state** is good | Shows confirmation | Keep |
| **No UTM capture** | Can't attribute ad signups | Add hidden fields for utm_source, utm_medium, utm_campaign |

### Recommended Streamlined Form
```
Step 1 (above fold): Phone + Area → "Join Waitlist"
Step 2 (optional, shown after signup): Frequency + Preference + Budget
```
This alone could boost form CVR by 15-25%.

---

## 6. Conversion Tracking — 0/100 ⚠️ BLOCKER

**No ad platform pixels detected in the codebase.**

| Tracker | Present? | Required For |
|---------|----------|-------------|
| Google Ads (gtag/gclid) | NO | Google Ads |
| Meta Pixel (fbclid) | NO | Facebook/Instagram Ads |
| Google Analytics 4 | NO | Attribution |
| UTM parameter capture | NO | All paid traffic |
| Vercel Analytics | YES | Basic pageviews only |

**This is a blocker.** Running ads without conversion tracking = burning money. You cannot optimize what you cannot measure.

### Must-Add Before Ads
1. **GA4** — free, essential. One `<script>` tag in AppShell.astro
2. **UTM capture** — hidden form fields that store utm_source/medium/campaign from URL params
3. **Google Ads conversion tag** — fires on waitlist signup
4. **Meta Pixel** — if running Meta ads, fires on PageView + Lead events

---

## 7. Ad-Specific Landing Page Issues

### Location Mismatch
- Page says **"Mumbai"** in multiple places (H1, meta description, default text)
- Product is targeting **Goa**
- Any Goa-targeted ad → Mumbai landing page = instant bounce

### No Dedicated Ad Landing Page
- Homepage serves both organic and ad traffic
- Ad traffic should go to a **stripped-down page** with:
  - No navigation distractions
  - Single CTA (join waitlist)
  - Message matched to the specific ad
  - No search bar (confusing for new visitors)

### Deep Link Strategy Missing
- If running seller-specific ads ("Order from [SellerName]"), link to `/seller/[id]`
- If running category ads ("Fresh Pomfret in Panjim"), no category landing pages exist

---

## Priority Fixes (Ranked by Ad ROI Impact)

| # | Fix | Impact | Effort |
|---|-----|--------|--------|
| 1 | **Add conversion tracking** (GA4 + UTM capture + pixel) | Blocker — can't run ads without this | 30 min |
| 2 | **Fix Mumbai → Goa** across all copy | Instant bounce reducer | 15 min |
| 3 | **Make H1 visible** + add hero image | +15-20% engagement from ad clicks | 20 min |
| 4 | **Remove fake social proof** avatars | Trust repair | 5 min |
| 5 | **Add privacy policy** page | Required by Google/Meta ad policies | 20 min |
| 6 | **Streamline form** to 3 fields (phone, area, submit) | +15-25% form CVR | 20 min |
| 7 | **Create dedicated ad landing page** (no nav, single CTA) | +20-30% ad CVR | 45 min |
| 8 | **Get custom email domain** (contact@relifish.store) | Trust signal | 15 min (external) |
| 9 | **Add UTM hidden fields** to waitlist form | Attribution tracking | 10 min |
| 10 | **Lazy-load Leaflet CSS** (only when map needed) | -100KB on first load | 15 min |

---

## Quick Win Summary

**Before ANY paid spend:**
1. GA4 + conversion tracking
2. Fix Mumbai → Goa
3. Privacy policy
4. Remove fake avatars

**Before scaling spend:**
5. Dedicated ad landing page
6. Streamlined 3-field form
7. Custom email domain
8. Hero image + visible headline

---

*Generated by /ads landing audit — 2026-04-15*
