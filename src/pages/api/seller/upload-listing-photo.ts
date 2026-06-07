import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

import { verifyToken } from "../../../lib/server/auth-token";

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
 * POST /api/seller/upload-listing-photo (multipart: seller_id, file)
 * Uploads listing photo. Auto-creates fish-photos bucket if missing.
 * Returns { url } — caller saves to fish_listings.photo_url.
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const form = await request.formData();
    const seller_id = form.get("seller_id")?.toString();
    const file = form.get("file") as File | null;

    if (!seller_id || !file) {
      return new Response(JSON.stringify({ error: "seller_id and file required" }), { status: 400 });
    }
    if (!verifyToken(request.headers.get("x-seller-token"), seller_id, "seller")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }
    if (file.size > 5 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: "File too large (max 5 MB)" }), { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    await ensureFishPhotosBucket(supabase);

    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `listings/${seller_id}/${Date.now()}.${ext}`;

    const { error: uploadErr } = await supabase.storage
      .from("fish-photos")
      .upload(path, file, { contentType: file.type || "image/jpeg" });

    if (uploadErr) {
      return new Response(JSON.stringify({ error: uploadErr.message }), { status: 500 });
    }

    const publicUrl = supabase.storage.from("fish-photos").getPublicUrl(path).data.publicUrl;
    return new Response(JSON.stringify({ url: publicUrl }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
