import type { SupabaseClient } from "@supabase/supabase-js";

export const STOP_WORDS = /^\s*(stop|stop updates|unsubscribe|band karo)\s*$/i;

/** Sets whatsapp_opt_out_at on every buyer row for this 91XXXXXXXXXX number. True if anyone was newly opted out. */
export async function optOutPhone(sb: SupabaseClient, phone: string): Promise<boolean> {
  const ten = phone.slice(2);
  const { data: buyers } = await sb.from("buyers").select("id, whatsapp_opt_out_at").or(`phone.eq.${ten},phone.eq.+91${ten},phone.eq.91${ten}`);
  const fresh = (buyers || []).filter((b: any) => !b.whatsapp_opt_out_at);
  if (!fresh.length) return false;
  await sb.from("buyers").update({ whatsapp_opt_out_at: new Date().toISOString() }).in("id", fresh.map((b: any) => b.id));
  return true;
}
