import type { APIRoute } from "astro";
import { supabase } from "../lib/supabase";

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    const [{ data: listingsData }, { data: sellersData }] = await Promise.all([
      supabase
        .from("fish_listings")
        .select("*, seller:sellers(*)")
        .or("is_available.eq.true,is_preorder_enabled.eq.true"),
      supabase
        .from("sellers")
        .select("*")
        .eq("is_active", true)
        .neq("name", "New Seller"),
    ]);

    const listings = listingsData || [];
    const sellers = sellersData || [];

    // Group active prices by species
    const speciesMap = new Map<string, { min: number; max: number; unit: string; sellers: Set<string> }>();

    for (const l of listings) {
      if (!l.seller?.is_active || l.seller?.name === "New Seller") continue;

      const species = (l.species || "").toLowerCase().trim();
      if (!species) continue;

      // Extract options pricing if available, else use standard listing price
      const rawOpts = Array.isArray(l.pricing_options) ? l.pricing_options : [];
      let minPrice = Infinity;
      let maxPrice = -Infinity;
      let unit = "kg";

      if (rawOpts.length > 0) {
        for (const o of rawOpts) {
          const p = Number(o?.price ?? o?.preorder_price_min ?? o?.preorder_price_max ?? l.price) || 0;
          if (p < minPrice) minPrice = p;
          if (p > maxPrice) maxPrice = p;
          if (o?.unit_label) unit = o.unit_label;
        }
      } else {
        const p = Number(l.price) || 0;
        minPrice = p;
        maxPrice = p;
        if (l.price_unit) unit = l.price_unit;
      }

      if (minPrice === Infinity) continue;

      const existing = speciesMap.get(species);
      if (existing) {
        existing.min = Math.min(existing.min, minPrice);
        existing.max = Math.max(existing.max, maxPrice);
        existing.sellers.add(l.seller.name);
      } else {
        speciesMap.set(species, {
          min: minPrice,
          max: maxPrice,
          unit,
          sellers: new Set([l.seller.name]),
        });
      }
    }

    // Dynamic Markdown generation
    let markdown = `# Live Fresh Fish Price Guide — Relifish Mumbai\n\n`;
    markdown += `*Last updated: Today (Live Database Catalogue)*\n\n`;
    markdown += `If you are searching for the **best fish shop near me**, a local **fish market near me**, or direct **fresh fish delivery Mumbai**, this live guide provides real-time pricing ranges compiled directly from our active sellers' catalogues.\n\n`;
    markdown += `Relifish connects buyers directly to local sellers in Tardeo, Kandivali, Thane, and Kamothe with **zero platform commission** or Swiggy/Zomato markups.\n\n`;
    markdown += `## Live Fresh Seafood Prices Across Mumbai\n\n`;
    markdown += `| Fish Species (English) | Live Price Range | Unit | Active Verified Sellers | Availability |\n`;
    markdown += `|-----------------------|------------------|------|-------------------------|--------------|\n`;

    if (speciesMap.size > 0) {
      for (const [species, data] of speciesMap.entries()) {
        const title = species.charAt(0).toUpperCase() + species.slice(1);
        const priceStr = data.min === data.max 
          ? `₹${data.min}` 
          : `₹${data.min} – ₹${data.max}`;
        const sellerList = Array.from(data.sellers).join(", ");
        markdown += `| **${title}** | ${priceStr} | ${data.unit} | ${sellerList} | Same-day & Pre-order |\n`;
      }
    } else {
      markdown += `| *No live products* | *Contact support* | *kg* | *All sellers* | *Pre-order available* |\n`;
    }

    markdown += `\n## Neighborhood-by-Neighborhood Availability\n\n`;
    markdown += `Our verified sellers serve the following hyperlocal zones in Mumbai:\n`;
    
    for (const s of sellers) {
      markdown += `- **${s.name}** in *${s.location_name || s.location || "Mumbai"}* (Accepts ${s.accepts_preorder ? "Pre-orders" : ""} ${s.has_delivery ? "and Delivery" : "for Pickup"})\n`;
    }

    markdown += `\n## Why Order from Relifish?\n\n`;
    markdown += `- **Direct Dock Pricing**: Pay what the shop charges. Zero delivery app commission markups (Swiggy/Zomato add 25–35%).\n`;
    markdown += `- **Daily Docks Catch**: Direct from docks daily. Fish reaches you within 24 hours of landing — no cold storage.\n`;
    markdown += `- **Secure Pre-order Lock**: Lock in today's pre-orders before 11 PM for morning catch fulfillment.\n`;

    return new Response(markdown, {
      status: 200,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "public, max-age=60, s-maxage=120",
      },
    });
  } catch (err: any) {
    return new Response(`# Live fresh fish price guide is temporarily offline\n\nError: ${err.message || "Connection failed"}`, {
      status: 500,
      headers: { "Content-Type": "text/markdown; charset=utf-8" },
    });
  }
};
