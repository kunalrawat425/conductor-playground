import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { sendCustomBuyerPush } from "../../../lib/server/buyer-push";

export const prerender = false;

function client() {
  const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || "";
  const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
  return createClient(supabaseUrl, supabaseServiceKey);
}

// Haversine distance formula in km
function getDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export const GET: APIRoute = async ({ request }) => {
  try {
    const authHeader = request.headers.get("authorization");
    const url = new URL(request.url);
    const testPhone = url.searchParams.get("test_phone");
    const force = url.searchParams.get("force") === "true";

    const cronSecret = import.meta.env.CRON_SECRET || process.env.CRON_SECRET || "";
    if (cronSecret && authHeader !== `Bearer ${cronSecret}` && !testPhone && !force) {
      return new Response("Unauthorized", { status: 401 });
    }

    const supabase = client();

    // 1. Fetch buyers with push enabled
    let hasPromoPushColumn = true;
    let buyersQuery = supabase
      .from("buyers")
      .select("id, phone, lat, lng, location_name, last_promo_push_sent_at, push_enabled")
      .eq("push_enabled", true)
      .not("push_subscription", "is", null);

    if (testPhone) {
      buyersQuery = buyersQuery.ilike("phone", `%${testPhone}%`);
    }

    let { data: buyers, error: buyersErr } = await buyersQuery;
    
    if (buyersErr && buyersErr.message?.includes("last_promo_push_sent_at")) {
      console.warn("Table buyers is missing last_promo_push_sent_at column. Running without frequency capping fallback.");
      hasPromoPushColumn = false;
      
      let fallbackQuery = supabase
        .from("buyers")
        .select("id, phone, lat, lng, location_name, push_enabled")
        .eq("push_enabled", true)
        .not("push_subscription", "is", null);

      if (testPhone) {
        fallbackQuery = fallbackQuery.ilike("phone", `%${testPhone}%`);
      }
      
      const fallbackRes = await fallbackQuery;
      buyers = fallbackRes.data;
      buyersErr = fallbackRes.error;
    }

    if (buyersErr) throw buyersErr;

    if (!buyers || buyers.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          sent: 0,
          reason: "No eligible buyers with push subscription found",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // 2. Fetch active sellers and their listings to perform distance matching
    const { data: sellers, error: sellersErr } = await supabase
      .from("sellers")
      .select("id, name, lat, lng, opens_at, open_days, has_delivery, delivery_rad, is_active")
      .eq("is_active", true);

    if (sellersErr) throw sellersErr;

    const { data: listings, error: listingsErr } = await supabase
      .from("fish_listings")
      .select("id, seller_id, species, is_available, weight_avail")
      .eq("is_available", true)
      .gt("weight_avail", 0);

    if (listingsErr) throw listingsErr;

    // Map sellers to their active listings count
    const sellerListingsMap = new Map<string, number>();
    for (const listing of listings || []) {
      const currentCount = sellerListingsMap.get(listing.seller_id) || 0;
      sellerListingsMap.set(listing.seller_id, currentCount + 1);
    }

    // Get current time in IST (UTC+5:30)
    const nowMs = Date.now();
    const nowISTMs = nowMs + 5.5 * 60 * 60 * 1000;
    const nowIST = new Date(nowISTMs);
    const curHour = nowIST.getUTCHours();
    const curMin = nowIST.getUTCMinutes();
    const DAY_NAMES_SHORT = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    const todayDayName = DAY_NAMES_SHORT[nowIST.getUTCDay()];

    const isMeatDay = ["wed", "fri", "sun"].includes(todayDayName);

    const log: any[] = [];
    let sentCount = 0;

    for (const buyer of buyers) {
      const hasLocation = buyer.lat != null && buyer.lng != null;
      const bLat = buyer.lat ? Number(buyer.lat) : null;
      const bLng = buyer.lng ? Number(buyer.lng) : null;

      // Frequency cap: Skip if sent within last 90 minutes (unless forced)
      if (hasPromoPushColumn && buyer.last_promo_push_sent_at && !force && !testPhone) {
        const lastSentTime = new Date(buyer.last_promo_push_sent_at).getTime();
        if (nowMs - lastSentTime < 90 * 60 * 1000) {
          log.push({
            buyer: buyer.phone,
            skipped: true,
            reason: "Frequency cap (sent within 90 minutes)",
          });
          continue;
        }
      }

      // Check triggers
      let triggered = false;
      let triggerReason = "";

      if (force || testPhone) {
        triggered = true;
        triggerReason = "Forced/Test trigger";
      } else if (curHour === 11) {
        triggered = true;
        triggerReason = "11:00 AM IST scheduled slot";
      } else if (curHour === 9) {
        if (!hasLocation) {
          triggered = true;
          triggerReason = "9:00 AM IST scheduled slot (No-location fallback)";
        } else if (!isMeatDay) {
          triggered = true;
          triggerReason = "9:00 AM IST scheduled slot (General Day)";
        }
      }

      // Shop open trigger check (for location-set buyers only)
      let nearbySellersWithOpenHour: any[] = [];
      let activeListingsNearby = false;

      if (hasLocation && bLat !== null && bLng !== null) {
        // Find sellers nearby
        const nearbySellers = (sellers || []).filter((s) => {
          if (s.lat == null || s.lng == null) return false;
          const dist = getDistanceKm(bLat, bLng, Number(s.lat), Number(s.lng));
          const maxRad = Number(s.delivery_rad) || 10;
          return dist <= maxRad;
        });

        // Filter by those opening today at the current hour
        nearbySellersWithOpenHour = nearbySellers.filter((s) => {
          if (!s.opens_at) return false;
          const openDays: string[] = s.open_days ?? DAY_NAMES_SHORT;
          if (openDays.length > 0 && !openDays.includes(todayDayName)) return false;

          const [sh, sm] = s.opens_at.split(":").map(Number);
          return sh === curHour;
        });

        if (nearbySellersWithOpenHour.length > 0) {
          triggered = true;
          triggerReason = `Shop open time slot (${nearbySellersWithOpenHour.map((s) => s.name).join(", ")})`;
        }

        // Determine if there are active listings among all nearby sellers
        activeListingsNearby = nearbySellers.some((s) => (sellerListingsMap.get(s.id) || 0) > 0);
      }

      if (!triggered) {
        continue;
      }

      // Compile notification copy based on Cases
      let title = "";
      let body = "";
      let urlPath = "/shop";

      if (hasLocation) {
        if (activeListingsNearby) {
          // Case A: Location Set & Active Seller Nearby
          title = "Fresh Fish Sellers are Live! 🐟";
          body = "Local fish sellers are now open in your area. Open Relifish to check today's fresh rates and order!";
        } else {
          // Case B: Location Set but No Nearby Active Sellers
          title = "Fresh Fish Coming Soon 🎣";
          const areaSuffix = buyer.location_name ? ` near ${buyer.location_name}` : "";
          body = `We're expanding fast! Request your neighborhood${areaSuffix} on our waitlist to get area updates and be first to know when sellers go live near you.`;
        }
      } else {
        // Case C: No Location Set
        title = "Discover Fresh Fish Rates 📍";
        body = "Set your location in your profile to check today's fresh catch rates. Not live in your area yet? Request your neighborhood on our waitlist for updates!";
      }

      // Send push notification
      const pushRes = await sendCustomBuyerPush(buyer.id, { title, body }, urlPath);
      if (pushRes.ok && pushRes.sent) {
        sentCount++;
        log.push({
          buyer: buyer.phone,
          sent: true,
          trigger: triggerReason,
          locationStatus: hasLocation ? (activeListingsNearby ? "Case A" : "Case B") : "Case C",
          title,
        });
      } else {
        log.push({
          buyer: buyer.phone,
          sent: false,
          reason: pushRes.ok ? pushRes.reason : pushRes.error,
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        sent: sentCount,
        day: todayDayName,
        isMeatDay,
        timeIST: `${String(curHour).padStart(2, "0")}:${String(curMin).padStart(2, "0")}`,
        log,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("meat-day-promo error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
