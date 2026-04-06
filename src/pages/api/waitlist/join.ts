import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";
const resendApiKey = import.meta.env.RESEND_API_KEY || "";

export const POST: APIRoute = async ({ request }) => {
  try {
    const { buyer_id, phone, area, fish_wanted, frequency, preference, budget, notes } = await request.json();

    if (!phone || !area) {
      return new Response(
        JSON.stringify({ error: "Phone and area are required" }),
        { status: 400 }
      );
    }

    const sb = createClient(supabaseUrl, supabaseServiceKey);

    const { data, error } = await sb
      .from("buyer_waitlist")
      .upsert(
        {
          buyer_id: buyer_id || null,
          phone,
          area,
          fish_wanted: fish_wanted || null,
          frequency: frequency || null,
          preference: preference || null,
          budget: budget || null,
          notes: notes || null,
        },
        { onConflict: "phone,area" }
      )
      .select()
      .single();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    // Total waitlist count
    const { count: totalCount } = await sb
      .from("buyer_waitlist")
      .select("*", { count: "exact", head: true });

    // Area-specific count (people waiting in same area, rough match)
    const { count: areaCount } = await sb
      .from("buyer_waitlist")
      .select("*", { count: "exact", head: true })
      .ilike("area", `%${area.split(/[, ]/)[0]}%`);

    // Send email notification
    if (resendApiKey) {
      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "Relifish Waitlist <onboarding@resend.dev>",
            to: "relifishstore@gmail.com",
            subject: `New Waitlist: ${area} — ${phone}`,
            html: `
              <h2>New Buyer Waitlist Entry</h2>
              <table style="border-collapse:collapse;font-family:sans-serif;">
                <tr><td style="padding:8px;font-weight:bold;">Phone</td><td style="padding:8px;">${phone}</td></tr>
                <tr><td style="padding:8px;font-weight:bold;">Area</td><td style="padding:8px;">${area}</td></tr>
                <tr><td style="padding:8px;font-weight:bold;">Fish wanted</td><td style="padding:8px;">${fish_wanted || "—"}</td></tr>
                <tr><td style="padding:8px;font-weight:bold;">Frequency</td><td style="padding:8px;">${frequency || "—"}</td></tr>
                <tr><td style="padding:8px;font-weight:bold;">Preference</td><td style="padding:8px;">${preference || "—"}</td></tr>
                <tr><td style="padding:8px;font-weight:bold;">Budget</td><td style="padding:8px;">${budget || "—"}</td></tr>
                <tr><td style="padding:8px;font-weight:bold;">Notes</td><td style="padding:8px;">${notes || "—"}</td></tr>
                <tr><td style="padding:8px;font-weight:bold;">Waitlist #</td><td style="padding:8px;">${totalCount}</td></tr>
                <tr><td style="padding:8px;font-weight:bold;">People in area</td><td style="padding:8px;">${areaCount}</td></tr>
              </table>
            `,
          }),
        });
        await sb.from("buyer_waitlist").update({ email_sent: true }).eq("id", data.id);
      } catch (_) {}
    }

    return new Response(
      JSON.stringify({
        success: true,
        waitlist_number: totalCount,
        area_count: areaCount,
        spots_remaining: Math.max(0, 1000 - (totalCount || 0)),
      }),
      { status: 200 }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
