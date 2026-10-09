/**
 * One row per push attempt in push_notification_logs, for buyers and sellers.
 * status: "success" | "failed" | "skipped" (no subscription, keys missing, …).
 * Never throws: a log miss must not block the notification itself.
 */
export async function logPush(
  supabase: any,
  row: { buyer_id?: string | null; seller_id?: string | null; title: string; body: string; url: string; status: "success" | "failed" | "skipped"; error_message?: string | null }
) {
  try {
    const { error } = await supabase.from("push_notification_logs").insert({
      buyer_id: row.buyer_id ?? null,
      seller_id: row.seller_id ?? null,
      title: row.title,
      body: row.body,
      url: row.url,
      status: row.status,
      error_message: row.error_message ?? null,
    });
    if (error) console.warn("[push-log] insert failed", error.message);
  } catch (e) {
    console.warn("[push-log] insert threw", e);
  }
}
