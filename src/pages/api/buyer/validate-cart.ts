import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

function client() {
  return createClient(supabaseUrl, supabaseServiceKey);
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { listing_ids } = body;
    if (!Array.isArray(listing_ids) || listing_ids.length === 0) {
      return new Response(JSON.stringify({ listings: [] }), { status: 200 });
    }

    const supabase = client();
    const { data: listingsData, error: listingsError } = await supabase
      .from("fish_listings")
      .select("id, is_available, weight_avail, pricing_options, is_preorder_enabled")
      .in("id", listing_ids);

    if (listingsError) throw listingsError;
    
    // Default mode is open if no seller is specified
    let sellerMode = "open";
    
    if (body.seller_id) {
      const { data: seller, error: sellerError } = await supabase
        .from("sellers")
        .select("opens_at, closes_at, open_days, preorder_days, accepts_preorder, preorder_cutoff_time")
        .eq("id", body.seller_id)
        .single();
        
      if (seller && !sellerError) {
        const nowIST = new Date(Date.now() + 5.5 * 3600 * 1000);
        const curMin = nowIST.getUTCHours() * 60 + nowIST.getUTCMinutes();
        const DAY_NAMES_SHORT = ['sun','mon','tue','wed','thu','fri','sat'];
        const todayDayName = DAY_NAMES_SHORT[nowIST.getUTCDay()];
        
        const openDays: string[] = seller.open_days ?? DAY_NAMES_SHORT;
        const preorderDays: string[] = seller.preorder_days ?? [];
        
        const isOpenByTime = (() => {
          if (!seller.opens_at || !seller.closes_at) return true;
          const [oh, om] = seller.opens_at.split(":").map(Number);
          const [ch, cm] = seller.closes_at.split(":").map(Number);
          const openMin = oh * 60 + om;
          const closeMin = ch * 60 + cm;
          if (openMin <= closeMin) return curMin >= openMin && curMin < closeMin;
          return curMin >= openMin || curMin <= closeMin;
        })();
        
        const isTodayOrderDay = !openDays.length || openDays.includes(todayDayName);
        const isEffectivelyOpen = isOpenByTime && isTodayOrderDay;
        
        const acceptsPreorder = !!seller.accepts_preorder;
        const isTodayPreorderDay = preorderDays.length > 0 ? preorderDays.includes(todayDayName) : acceptsPreorder;
        const isBeforeCutoff = (() => {
          if (!seller.preorder_cutoff_time) return true;
          const [ch, cm] = seller.preorder_cutoff_time.split(":").map(Number);
          return curMin < ch * 60 + cm;
        })();
        const isAfterCloseTime = (() => {
          if (!seller.closes_at) return true;
          const [ch, cm] = seller.closes_at.split(":").map(Number);
          return curMin >= ch * 60 + cm;
        })();
        
        const isPreorderMode = !isEffectivelyOpen && acceptsPreorder && isTodayPreorderDay && isBeforeCutoff && (!isTodayOrderDay || isAfterCloseTime);
        const isClosed = !isEffectivelyOpen && !isPreorderMode;
        
        if (isClosed) sellerMode = "closed";
        else if (isPreorderMode) sellerMode = "preorder";
        else sellerMode = "open";
      }
    }

    return new Response(JSON.stringify({ listings: listingsData || [], seller_mode: sellerMode }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
