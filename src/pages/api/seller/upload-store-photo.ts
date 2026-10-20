import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { imageExtension, IMAGE_MIME } from "../../../lib/server/image-upload";

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
 * POST /api/seller/upload-store-photo (multipart: seller_id, file, kind?)
 * kind=banner (default): wide store photo -> sellers.store_image_url
 * kind=logo: square store logo -> sellers.logo_url (migration 081)
 * Uploads to the fish-photos bucket under sellers/<id>/<store|logo>.<ext>.
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const form = await request.formData();
    const seller_id = form.get("seller_id")?.toString();
    const seller_phone = form.get("seller_phone")?.toString();
    const file = form.get("file") as File | null;
    const remove = form.get("remove")?.toString();
    const isLogo = form.get("kind")?.toString() === "logo";
    const name = isLogo ? "logo" : "store";
    const column = isLogo ? "logo_url" : "store_image_url";

    if (!seller_id) {
      return new Response(JSON.stringify({ error: "seller_id required" }), { status: 400 });
    }

    // BUG-12 gate
    const { assertSellerOwns } = await import("../../../lib/server/assert-seller");
    const authCheck = await assertSellerOwns(seller_id, seller_phone, request);
    if (authCheck instanceof Response) return authCheck;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    if (remove === "1") {
      const path = `sellers/${seller_id}/${name}`;
      await supabase.storage.from("fish-photos").remove([`${path}.jpg`, `${path}.png`, `${path}.webp`, `${path}.jpeg`]);
      const { error } = await supabase.from("sellers").update({ [column]: null }).eq("id", seller_id);
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
      return new Response(JSON.stringify({ removed: true }), { status: 200 });
    }

    if (!file) {
      return new Response(JSON.stringify({ error: "file required" }), { status: 400 });
    }
    if (file.size > 5 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: "File too large (max 5 MB)" }), { status: 400 });
    }
    // Declared type must be allowed AND the bytes must really be JPEG / PNG / WebP.
    const ext = await imageExtension(file);
    if (!ext || (file.type && !Object.values(IMAGE_MIME).includes(file.type as any))) {
      return new Response(JSON.stringify({ error: "Only JPEG, PNG or WebP images allowed" }), { status: 400 });
    }

    await ensureFishPhotosBucket(supabase);
    const path = `sellers/${seller_id}/${name}.${ext}`;

    const { error: uploadErr } = await supabase.storage
      .from("fish-photos")
      .upload(path, file, { upsert: true, contentType: IMAGE_MIME[ext] });

    if (uploadErr) {
      return new Response(JSON.stringify({ error: uploadErr.message }), { status: 500 });
    }

    // ?v= busts browser/CDN caches: the path is reused on every re-upload.
    const publicUrl = `${supabase.storage.from("fish-photos").getPublicUrl(path).data.publicUrl}?v=${Date.now()}`;

    const { error: saveErr } = await supabase.from("sellers").update({ [column]: publicUrl }).eq("id", seller_id);
    if (saveErr) {
      // e.g. logo_url column missing before migration 081 is applied.
      return new Response(JSON.stringify({ error: isLogo ? "Logo upload isn't available yet. Please try later." : saveErr.message }), { status: 500 });
    }

    return new Response(JSON.stringify({ url: publicUrl }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};
