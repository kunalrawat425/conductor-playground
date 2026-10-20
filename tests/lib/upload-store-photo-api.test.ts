import { describe, it, expect, vi } from "vitest";

/** /api/seller/upload-store-photo rejects oversize and non-image uploads before touching storage. */
const storage = { upload: vi.fn(), listBuckets: vi.fn() };
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ storage: { listBuckets: storage.listBuckets, from: () => storage } }) }));
vi.mock("../../src/lib/server/assert-seller", () => ({ assertSellerOwns: async () => ({ ok: true }) }));
const { POST } = await import("../../src/pages/api/seller/upload-store-photo");

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0];
const send = async (file: File, kind = "logo") => {
  const form = new FormData();
  form.append("seller_id", "s1");
  form.append("kind", kind);
  form.append("file", file);
  const res = await POST({ request: new Request("http://x/api/seller/upload-store-photo", { method: "POST", body: form }) } as any);
  return { status: res.status, error: (await res.json()).error };
};

describe("upload-store-photo validation", () => {
  it("rejects files over 5 MB", async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(JPEG);
    expect(await send(new File([big], "a.jpg", { type: "image/jpeg" }))).toEqual({ status: 400, error: "File too large (max 5 MB)" });
  });

  it("rejects a GIF, and an SVG renamed to .jpg, by their bytes", async () => {
    const gif = new File([new TextEncoder().encode("GIF89a......")], "a.gif", { type: "image/gif" });
    const svg = new File([new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>")], "a.jpg", { type: "image/jpeg" });
    for (const f of [gif, svg]) expect(await send(f)).toEqual({ status: 400, error: "Only JPEG, PNG or WebP images allowed" });
  });

  it("rejects real JPEG bytes declared as an unsupported type", async () => {
    expect((await send(new File([new Uint8Array(JPEG)], "a.heic", { type: "image/heic" }))).status).toBe(400);
    expect(storage.upload).not.toHaveBeenCalled();
  });
});
