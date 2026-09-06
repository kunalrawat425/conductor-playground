import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

async function ensureFishPhotosBucket(supabase: ReturnType<typeof createClient>) {
  const { data: buckets } = await supabase.storage.listBuckets();
  const exists = (buckets || []).some((b: any) => b.id === "fish-photos" || b.name === "fish-photos");
  if (!exists) {
    await supabase.storage.createBucket("fish-photos", { public: true, fileSizeLimit: 5242880 });
  }
}

/**
 * POST /api/seller/upload-store-photo (multipart: seller_id, file)
 * Uploads seller store cover photo to fish-photos bucket.
 * Saves public URL to sellers.store_image_url.
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const form = await request.formData();
    const seller_id = form.get("seller_id")?.toString();
    const seller_phone = form.get("seller_phone")?.toString();
    const file = form.get("file") as File | null;
    const remove = form.get("remove")?.toString();

    if (!seller_id) {
      return new Response(JSON.stringify({ error: "seller_id required" }), { status: 400 });
    }

    // BUG-12 gate
    const { assertSellerOwns } = await import("../../../lib/server/assert-seller");
    const authCheck = await assertSellerOwns(seller_id, seller_phone);
    if (authCheck instanceof Response) return authCheck;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    if (remove === "1") {
      const path = `sellers/${seller_id}/store`;
      await supabase.storage.from("fish-photos").remove([`${path}.jpg`, `${path}.png`, `${path}.webp`, `${path}.jpeg`]);
      await supabase.from("sellers").update({ store_image_url: null }).eq("id", seller_id);
      return new Response(JSON.stringify({ removed: true }), { status: 200 });
    }

    if (!file) {
      return new Response(JSON.stringify({ error: "file required" }), { status: 400 });
    }
    if (file.size > 5 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: "File too large (max 5 MB)" }), { status: 400 });
    }

    await ensureFishPhotosBucket(supabase);

    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `sellers/${seller_id}/store.${ext}`;

    const { error: uploadErr } = await supabase.storage
      .from("fish-photos")
      .upload(path, file, { upsert: true, contentType: file.type || "image/jpeg" });

    if (uploadErr) {
      return new Response(JSON.stringify({ error: uploadErr.message }), { status: 500 });
    }

    const publicUrl = supabase.storage.from("fish-photos").getPublicUrl(path).data.publicUrl;

    await supabase.from("sellers").update({ store_image_url: publicUrl }).eq("id", seller_id);

    return new Response(JSON.stringify({ url: publicUrl }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
