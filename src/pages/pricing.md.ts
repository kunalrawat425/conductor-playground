import type { APIRoute } from "astro";
import { supabase } from "../lib/supabase";
import { cleanSellerName, stripContactInfo } from "../lib/seller-display";

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
        existing.sellers.add(cleanSellerName(l.seller.name));
      } else {
        speciesMap.set(species, {
          min: minPrice,
          max: maxPrice,
          unit,
          sellers: new Set([cleanSellerName(l.seller.name)]),
        });
      }
    }

    // Dynamic Markdown generation
    let markdown = `# Live Fresh Fish Price Guide — Relifish (Thane & Mumbai)\n\n`;
    markdown += `*Last updated: Today (Live Database Catalogue)*\n\n`;
    markdown += `This guide lists live price ranges from the current listings of active sellers on Relifish. Prices change daily and are set by each seller.\n\n`;
    markdown += `Relifish connects buyers directly to local fish sellers in Thane, South Mumbai (Tardeo) and Kamothe (Navi Mumbai). Sellers pay 0% commission and buyers pay the seller's own price.\n\n`;
    markdown += `## Live Fresh Fish Prices\n\n`;
    markdown += `| Fish Species (English) | Live Price Range | Unit | Sellers | Availability |\n`;
    markdown += `|-----------------------|------------------|------|---------|--------------|\n`;

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
    markdown += `Active sellers and where they are based (each seller sets their own delivery radius):\n`;
    
    for (const s of sellers) {
      markdown += `- **${cleanSellerName(s.name)}** in *${stripContactInfo(s.location_name) || "Mumbai"}* (Accepts ${s.accepts_preorder ? "Pre-orders" : ""} ${s.has_delivery ? "and Delivery" : "for Pickup"})\n`;
    }

    markdown += `\n## Why Order from Relifish?\n\n`;
    markdown += `- **Seller's own price**: Relifish adds no platform markup and charges sellers 0% commission.\n`;
    markdown += `- **Listed daily**: Sellers list what they have each day. Order same-day during opening hours, or pre-order for tomorrow.\n`;
    markdown += `- **Pre-order pricing**: Pre-order prices are a range. You pay the top of the range and the difference is refunded once the seller sets the final price.\n`;
    markdown += `- **Refunds**: If a seller declines or you cancel before they confirm, the full amount is refunded via Razorpay, usually within 5 to 7 working days.\n`;
    markdown += `- **Contact**: WhatsApp 9152207607, contact@relifish.store, 7:30 AM to 9 PM.\n`;

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
