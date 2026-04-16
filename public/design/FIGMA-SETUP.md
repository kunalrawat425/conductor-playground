# Figma MCP Setup — Relifish V2

Two paths to Figma. Pick one.

---

## Path A: Figma Dev Mode MCP (Claude pushes direct)

### Prerequisites
- Figma desktop app (not web) — free works
- Active Figma file open

### Setup (3 min)

**1. Enable MCP in Figma desktop:**
- Figma menu → Preferences → **Enable Dev Mode MCP Server**
- Status bar bottom-right shows: `MCP server running on http://127.0.0.1:3845/mcp`

**2. Add to Claude Code config:**

Edit `~/.claude/config.json` (or create):

```json
{
  "mcpServers": {
    "figma": {
      "url": "http://127.0.0.1:3845/mcp",
      "type": "streamable-http"
    }
  }
}
```

**3. Restart Claude Code.**

**4. Test:**
Say: *"push atoms/buttons.html to the currently open Figma file"* — I'll create components via MCP.

### What Figma MCP can do
- Create frames, components, variants
- Apply colors, typography, effects from design tokens
- Generate code from selected Figma nodes
- Read existing design files (sync back)

### Limits
- Must have Figma desktop running + file open
- One file at a time (whatever's focused)
- Doesn't create new Figma files — only edits open file

---

## Path B: html.to.design plugin (manual import, no MCP)

### Fastest path. No config.

**1. Install plugin:**
- Figma → Resources → Plugins → search "html.to.design"
- Install (free tier: 3 imports/day, Pro: unlimited)

**2. Deploy design files to live URL:**
Files already in `public/design/` — deploy to Vercel to get public URLs.

Once deployed: `https://relifish.store/design/atoms/buttons.html`

**3. Import each file:**
- Open Figma file
- Run html.to.design plugin
- Paste URL → click Import
- All elements become Figma layers

### Recommended import order
1. `foundations.html` → import styles first (colors, typography)
2. `atoms/*.html` → create base components
3. `molecules/*.html` → composed components
4. `organisms/*.html` → large sections
5. `screens/*.html` → full phone mockups

---

## File Structure

```
public/design/
├── index.html                    # Main index (all files)
├── foundations.html              # Design tokens
├── FIGMA-SETUP.md                # This file
├── _shared.css                   # Shared styles
├── atoms/
│   ├── buttons.html              # AddBtn, CTABtn, CartBtn, NavItem
│   ├── badges.html               # RatingBadge, OfferBadge, StatusTag
│   ├── inputs.html               # TextInput, SearchBar, OTP, SlotPicker
│   └── icons.html                # Category + nav icons
├── molecules/
│   ├── seller-card.html          # Home page primary card
│   ├── menu-item.html            # 2-col grid product card
│   ├── cart-bar.html             # Floating cart pill (5 variants)
│   ├── category-strip.html       # Horizontal categories
│   ├── preorder-banner.html      # Pre-order CTA (3 variants)
│   └── address-card.html         # Address w/ icon + actions
├── organisms/
│   ├── app-header.html           # Brand header + location
│   ├── bottom-nav.html           # 5-tab buyer / 4-tab seller
│   ├── seller-hero.html          # Seller page top section
│   └── checkout-sheet.html       # 3-step bottom sheet
└── screens/
    ├── 01-home.html              # Seller browse
    ├── 02-seller-page.html       # Menu + cart
    ├── 03-preorder.html          # Pre-order wizard
    ├── 04-orders.html            # Tracking + history
    ├── 05-profile.html           # Account settings
    ├── 06-search.html            # Full-screen search
    └── 07-seller-dashboard.html  # Seller ops
```

---

## Figma page structure (recommended)

When imported, organize as:

```
🎨 Relifish V2 (Figma file)
├── 📐 01 · Foundations
│   ├── Colors
│   ├── Typography
│   ├── Spacing
│   ├── Radius
│   └── Shadows
├── ⚛️ 02 · Atoms
│   ├── Buttons
│   ├── Badges & Tags
│   ├── Inputs
│   └── Icons
├── 🧬 03 · Molecules
│   ├── Seller Card
│   ├── Menu Item
│   ├── Cart Bar
│   ├── Category Strip
│   ├── Pre-order Banner
│   └── Address Card
├── 🦴 04 · Organisms
│   ├── App Header
│   ├── Bottom Nav
│   ├── Seller Hero
│   └── Checkout Sheet
└── 📱 05 · Screens
    ├── 01 · Home
    ├── 02 · Seller Page
    ├── 03 · Pre-order
    ├── 04 · Orders
    ├── 05 · Profile
    ├── 06 · Search
    └── 07 · Seller Dashboard
```

---

## Once imported — next steps

**Make components reusable:**
1. Right-click each atom/molecule → "Create component"
2. Set up variants (e.g., Button → default/loading/disabled)
3. Use component instances in screens

**Link design tokens:**
1. Create color styles from foundations (Colors → brand, green, orange, etc.)
2. Create text styles (h1, h2, body, caption, price)
3. Create effect styles (shadow-sm, shadow, shadow-md, shadow-lg)

**Prototype flows:**
- Link 01-home → 02-seller-page (tap seller card)
- Link 02-seller-page → checkout-sheet (tap cart bar)
- Link 01-home → 03-preorder (tap pre-order banner)

---

## Which path now?

- **Want Claude to push direct?** → Enable Figma MCP (Path A), then say *"push all components to Figma"*
- **Want fastest manual import?** → Deploy + use html.to.design (Path B)
- **Hybrid?** → Use html.to.design for first import (screens), then Figma MCP for iterations
