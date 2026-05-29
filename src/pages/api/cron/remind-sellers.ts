import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

function client() {
  return createClient(supabaseUrl, supabaseServiceKey);
}

// Ensure the endpoint is secured. Use a CRON_SECRET or rely on edge security.
const CRON_SECRET = import.meta.env.CRON_SECRET || "";

export const GET: APIRoute = async ({ request }) => {
  try {
    const authHeader = request.headers.get("authorization");
    
    // Parse test_phone from URL
    const url = new URL(request.url);
    const testPhone = url.searchParams.get("test_phone");

    if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}` && !testPhone) {
      return new Response("Unauthorized", { status: 401 });
    }

    const supabase = client();

    let query = supabase
      .from("sellers")
      .select("id, name, opens_at, open_days, phone")
      .eq("is_active", true)
      .not("opens_at", "is", null);
      
    if (testPhone) {
      // For testing, just find the seller with this phone
      query = query.ilike("phone", `%${testPhone}%`);
    }

    const { data: sellers, error } = await query;

    if (error) throw error;
    if (!sellers || sellers.length === 0) {
      return new Response(JSON.stringify({ sent: 0, reason: "No active sellers found" }), { status: 200 });
    }

    const nowIST = new Date(Date.now() + 5.5 * 3600 * 1000);
    const curMin = nowIST.getUTCHours() * 60 + nowIST.getUTCMinutes();
    const DAY_NAMES_SHORT = ['sun','mon','tue','wed','thu','fri','sat'];
    const todayDayName = DAY_NAMES_SHORT[nowIST.getUTCDay()];

    // Only send SMS reminders on Friday, Saturday, and Sunday
    if (!['fri', 'sat', 'sun'].includes(todayDayName)) {
      return new Response(JSON.stringify({ sent: 0, reason: `No reminders sent on ${todayDayName}. Only Fri, Sat, Sun.` }), { status: 200 });
    }

    let remindersSent = 0;
    const remindersLog: any[] = [];

    for (const seller of sellers) {
      const openDays: string[] = seller.open_days ?? DAY_NAMES_SHORT;
      
      let is60MinReminder = false;
      let is30MinReminder = false;

      if (testPhone) {
        // Force send for testing
        is60MinReminder = true;
      } else {
        // Skip if seller is not opening today
        if (openDays.length > 0 && !openDays.includes(todayDayName)) {
          continue;
        }

        if (!seller.opens_at) continue;

        const [oh, om] = seller.opens_at.split(":").map(Number);
        const openMin = oh * 60 + om;
        
        const diffMins = openMin - curMin;
        is60MinReminder = diffMins >= 58 && diffMins <= 62;
        is30MinReminder = diffMins >= 28 && diffMins <= 32;
      }

      if (is60MinReminder || is30MinReminder) {
        // Send SMS Reminder
        const minutesLeft = is60MinReminder ? 60 : 30;
        const message = `Hello ${seller.name},\nYour Relifish shop opens at ${seller.opens_at.slice(0, 5)}.\nPlease update your prices & stock here: https://relifish.store/dashboard/inventory\nCustomers are actively looking for prices, and not updating may cause loss of sales or pricing issues. - Relifish`;

        // Actual SMS API integration via MSG91 Flow API
        const msg91AuthKey = import.meta.env.MSG91_AUTH_KEY || "";
        // You'll need to create a specific DLT-approved template for this reminder
        const msg91TemplateId = import.meta.env.MSG91_REMINDER_TEMPLATE_ID || "";
        const msg91SenderId = import.meta.env.MSG91_SENDER_ID || "RELFSH";
        
        if (msg91AuthKey && msg91TemplateId && seller.phone) {
          try {
            const formattedPhone = seller.phone.replace(/[^0-9]/g, ""); // e.g. 919876543210
            
            const payload = {
              flow_id: msg91TemplateId,
              sender: msg91SenderId,
              mobiles: formattedPhone,
              // Variables that your MSG91 template expects (adjust names based on your template design)
              shop_name: seller.name,
              open_time: seller.opens_at.slice(0, 5)
            };

            const res = await fetch("https://api.msg91.com/api/v5/flow/", {
              method: "POST",
              headers: {
                "authkey": msg91AuthKey,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(payload),
            });
            
            const data = await res.json().catch(() => ({}));
            if (data.type === "success") {
              console.log(`[MSG91 Reminder] Sent to ${seller.name} (${seller.phone})`);
            } else {
              console.error(`[MSG91 Reminder] Failed to send to ${seller.name}:`, data);
            }
          } catch (e) {
            console.error(`[MSG91 Reminder] Error sending to ${seller.name}:`, e);
          }
        } else {
          console.log(`[MSG91 Reminder - Missing Env or Phone] Would send to ${seller.name} (${seller.phone}):\n${message}`);
        }
        
        remindersLog.push({
          seller: seller.name,
          phone: seller.phone,
          type: `${minutesLeft}min`
        });
        
        remindersSent++;
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      sent: remindersSent, 
      log: remindersLog 
    }), { 
      status: 200, 
      headers: { "Content-Type": "application/json" } 
    });

  } catch (err: any) {
    console.error("remind-sellers error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
