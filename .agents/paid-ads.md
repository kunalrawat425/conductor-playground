# Relifish Paid Ads Playbook

*Last updated: 2026-04-14*
*Monthly budget: ₹12,000 | Platforms: Meta (primary), Google Search (secondary)*

## Budget Split

| Channel | Monthly Spend | % | Role |
|---|---|---|---|
| Meta (Instagram + Facebook) | ₹8,000 | 67% | Demand generation, hyperlocal awareness, waitlist capture |
| Google Search | ₹2,500 | 21% | Intent capture (long-tail fish queries) |
| Retargeting (Meta) | ₹1,000 | 8% | Waitlist-to-activation, repeat buyer nudge |
| Creative refresh buffer | ₹500 | 4% | Boost best organic posts |

**CPA targets:**
- Waitlist signup: ≤ ₹30
- First order (post-launch): ≤ ₹250
- Repeat buyer: ≤ ₹80

---

## Meta Campaign Architecture

### Campaign 1: Waitlist Signups (Priority 1 neighborhoods)
**Objective:** Conversions → Lead
**Budget:** ₹4,500/month (₹150/day)
**Goal:** 150–200 waitlist signups/month at ≤ ₹30 CPA

**Ad sets (one per neighborhood):**
- META_Conv_Waitlist_Andheri-Juhu-Versova_2026-04
- META_Conv_Waitlist_Bandra-Khar-Santacruz_2026-04
- META_Conv_Waitlist_Dadar-Prabhadevi-Worli_2026-04

**Targeting per ad set:**
- Location: 2 km radius around neighborhood centroid
- Age: 25–55
- Gender: All (primary buyer skews female, but don't exclude — married couples often decide together)
- Languages: English, Marathi, Hindi
- Interests (broad — Meta optimizes): "Seafood", "Fish", "Cooking", "Fresh produce", "Mumbai food", "Indian cuisine", "Home cooking"
- Exclusions: Existing waitlist (custom audience from past conversions + CSV upload)

**Placements:** Instagram Feed, Instagram Stories, Instagram Reels, Facebook Feed. **Exclude:** Audience Network, Messenger.

**Landing page:** relifish.store/buyer-detailed.html (waitlist form)

**Optimization:** Lead event (custom conversion on waitlist submit).

---

### Campaign 2: Awareness / Video Views
**Objective:** ThruPlay (15-sec video completion)
**Budget:** ₹2,500/month (₹80/day)
**Goal:** Warm up 10K+ users who can be retargeted; build "hyperlocal direct" brand association.

**Ad sets:**
- Broad Mumbai 25–55, interest: "Seafood" + "Fresh produce"
- Run one 15–20s vertical video: "A day in the life of a Versova hyperlocal seller" (borrowed-channel creator content repurposed)

**Placements:** IG Reels, IG Stories, FB Reels.

---

### Campaign 3: Retargeting (Waitlist → Activation)
**Objective:** Conversions → Landing Page View / Purchase (post-launch)
**Budget:** ₹1,000/month (₹33/day)
**Goal:** Bring waitlist back to place first order when their area goes live.

**Custom audiences:**
- Website visitors past 30 days (all pages)
- Video viewers 75%+ from Campaign 2
- Waitlist signups (uploaded list — converted to Custom Audience)

**Frequency cap:** 3/week.

**Creative:** "Your area is live" + testimonial from first 50 buyers.

---

### Campaign 4: Seller Acquisition (secondary — borrow from Meta budget when seller-light)
**Objective:** Leads
**Budget:** ₹500/month (if needed, else fold into C1)
**Targeting:** Custom locations near wholesale fish markets (Sassoon Dock, Versova, Bhaucha Dhakka, Crawford Market). Interests: "Small business", "Fishing industry". Age 25–55.
**Creative:** Marathi-first, hyperlocal-respectful tone. Landing: seller-detailed.html.

---

## Google Search Architecture

### Campaign 1: High-intent local queries
**Budget:** ₹2,000/month (₹65/day)
**Match types:** Phrase + Exact only. No broad match (it'll blow budget on garbage queries in Hindi/Marathi).

**Ad groups + keywords:**

| Ad Group | Keywords (phrase / exact) |
|---|---|
| Species — Pomfret | "buy pomfret online mumbai", "pomfret home delivery mumbai", "fresh pomfret andheri" |
| Species — Surmai | "buy surmai online mumbai", "surmai price mumbai", "fresh surmai home delivery" |
| Species — Rawas | "buy rawas online mumbai", "rawas fish mumbai online" |
| Species — Bangda/Ghol | "bangda fish online mumbai", "ghol fish mumbai" |
| Generic | "fresh fish home delivery mumbai", "buy fish online mumbai", "fish market online mumbai" |
| Competitor | "freshtohome mumbai", "licious alternative mumbai" |

**Negative keywords (critical):**
- "recipe", "curry", "fry", "how to cook", "in hindi", "in marathi" (unless content arm wants to rank)
- "aquarium", "pet", "fishing rod", "fishing game"
- "restaurant", "near me restaurant", "buffet"
- "jobs", "wholesale", "license", "export"

**Ad extensions:** Sitelinks (Waitlist / Sellers / How it Works / WhatsApp), Call extension with 9152207607, Location extension.

**Landing pages:**
- Species queries → buyer-detailed.html with anchor to that species (build anchor links: #surmai, #pomfret, etc.)
- Competitor queries → relifish.store with explicit comparison bullet strip
- Generic → buyer-detailed.html

---

### Campaign 2: Brand Defense
**Budget:** ₹500/month (₹16/day) — don't skip; FreshToHome/Licious will start bidding on "relifish" once we're visible.
**Keywords:** [relifish], "relifish mumbai", "relifish fish"
**Expected CPC:** ₹3–8. Cheap protection.

---

## Measurement & Tracking

**Must-haves before spending a single rupee:**
1. Meta Pixel installed on relifish.store (already present via Vercel layout — verify via Events Manager)
2. Custom conversion for waitlist submit (URL-based fallback: success toast = `/api/waitlist/join` POST response + client-side Lead event fire)
3. Google Ads conversion tag + GA4 linked
4. UTM conventions:
   - `utm_source={platform}&utm_medium={paid}&utm_campaign={campaign-name}&utm_content={ad-name}`
   - Example: `?utm_source=meta&utm_medium=paid&utm_campaign=waitlist_bandra_2026-04&utm_content=hyperlocal_video_v1`
5. WhatsApp click tracker (wa.me link with UTM-style param `?text=relifish-ad-bandra`)

**Weekly review cadence (every Monday):**
- Spend vs pacing
- CPA per ad set (kill if >2× target for 5 consecutive days with 30+ clicks)
- Top 3 / bottom 3 creatives
- Frequency cap check (>3.5 on Meta = fatigue — refresh)
- Waitlist → activation rate (new metric post-launch)

---

## Scaling Rules

| Condition | Action |
|---|---|
| Ad set CPA <₹20 and volume steady for 7 days | +20% daily budget |
| Ad set CPA 20–30, stable | Hold |
| Ad set CPA >₹40 for 5+ days | Kill or rework creative |
| Frequency >3.5 | Refresh creative |
| New neighborhood needs to hit threshold | Duplicate winning ad set with new geo radius |

**Never increase budget by >30% in one step** — Meta's learning phase resets.

---

## Creative Testing Matrix (launch month)

Run 4 creative concepts × 2 hooks = 8 ad variants in Campaign 1.

| Concept | Hook A | Hook B |
|---|---|---|
| 1. Hyperlocal direct (seller at dock) | "The fish your local stall can't get" | "Same-day catch. No middleman." |
| 2. Price comparison (Swiggy vs Relifish) | "Stop paying 30% extra on fish" | "Fair prices. Direct from sellers." |
| 3. Pre-order magic | "Order tomorrow's Pomfret tonight" | "Never miss fresh fish again" |
| 4. Variety showcase | "Surmai, Rawas, Pomfret — all in one app" | "Beyond your local stall's 4 options" |

Kill bottom 4 after 7 days. Double down on top 2. Refresh new concepts monthly.

---

## Common Mistakes to Avoid (Relifish-specific)

- **Don't run ads in neighborhoods without sellers.** Waitlist signups rot if activation is 3+ months away.
- **Don't use stock fish imagery** — Mumbai buyers spot it instantly. Use real hyperlocal seller photos + real daily catch.
- **Don't over-target "Hyperlocal community"** as an interest — too narrow, Meta won't spend. Use behavior + location instead.
- **Don't run English-only ads** in Dadar/Prabhadevi/Worli — Marathi creative lifts CTR 2–3× here.
- **Don't skip brand defense on Google** once you appear in press.
- **Don't discount in the ad copy** — discounts attract deal-hunters, not repeat buyers. Lead with freshness.

---

## First 30-Day Execution Checklist

- [ ] Week 1: Pixel verification, conversion events wired, UTM spec locked, 8 creative variants produced
- [ ] Week 1: Meta Campaigns 1–2 live in 2 Priority 1 neighborhoods
- [ ] Week 1: Google Search Campaign 1 live with top 3 ad groups
- [ ] Week 2: Add Priority 1 neighborhood #3, turn on retargeting audience building
- [ ] Week 2: First optimization — kill bottom 4 creatives, scale winners
- [ ] Week 3: Brand defense campaign on Google (after first press hit or when we hit 500 waitlist)
- [ ] Week 3: First seller-acquisition push if seller-light
- [ ] Week 4: Monthly review — CPA, frequency, neighborhood-by-neighborhood performance, budget reallocation for Month 2
