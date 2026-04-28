import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_KEY || "";

/**
 * POST /api/seller/upload-store-photo (multipart: seller_id, file)
 * Uploads seller store cover photo to fish-photos bucket.
 * Saves public URL to sellers.store_image_url.
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const form = await request.formData();
    const seller_id = form.get("seller_id")?.toString();
    const file = form.get("file") as File | null;
    const remove = form.get("remove")?.toString();

    if (!seller_id) {
      return new Response(JSON.stringify({ error: "seller_id required" }), { status: 400 });
    }

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

    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `sellers/${seller_id}/store.${ext}`;

    const { error: uploadErr } = await supabase.storage
      .from("fish-photos")
      .upload(path, file, { upsert: true, contentType: file.type || "image/jpeg" });

    if (uploadErr) {
      const msg = /bucket.*not found|not found.*bucket/i.test(uploadErr.message)
        ? "fish-photos bucket not found — create a public bucket named 'fish-photos' in Supabase Dashboard → Storage."
        : uploadErr.message;
      return new Response(JSON.stringify({ error: msg }), { status: 500 });
    }

    const publicUrl = supabase.storage.from("fish-photos").getPublicUrl(path).data.publicUrl;

    await supabase.from("sellers").update({ store_image_url: publicUrl }).eq("id", seller_id);

    return new Response(JSON.stringify({ url: publicUrl }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
