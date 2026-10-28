import { describe, it, expect, vi } from "vitest";

/** /api/seller/upload-listing-photo: size, declared type and magic bytes are checked before storage. */
const storage = {
  upload: vi.fn(async () => ({ error: null })),
  getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn/${path}` } }),
};
const listBuckets = vi.fn(async () => ({ data: [{ id: "fish-photos" }] }));
let sellerRow: { is_active: boolean } | null = { is_active: true };
const sellers = { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: sellerRow, error: null }) }) }) };
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ storage: { listBuckets, from: () => storage }, from: () => sellers }) }));
// Real assertSellerApproved (reads is_active from the mocked client); ownership is assumed.
vi.mock("../../src/lib/server/assert-seller", async (orig) => ({ ...(await orig<object>()), assertSellerOwns: async () => ({ ok: true }) }));
const { POST } = await import("../../src/pages/api/seller/upload-listing-photo");

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0];
const send = async (file: File) => {
  const form = new FormData();
  form.append("seller_id", "s1");
  form.append("file", file);
  const res = await POST({ request: new Request("http://x/api/seller/upload-listing-photo", { method: "POST", body: form }) } as any);
  return { status: res.status, body: await res.json() };
};

describe("upload-listing-photo validation", () => {
  it("rejects files over 5 MB", async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(JPEG);
    expect(await send(new File([big], "a.jpg", { type: "image/jpeg" }))).toEqual({ status: 400, body: { error: "File too large (max 5 MB)" } });
  });

  it("rejects a GIF, an SVG renamed to .jpg, JPEG bytes declared as HEIC, and an empty file", async () => {
    const files = [
      new File([new TextEncoder().encode("GIF89a......")], "a.gif", { type: "image/gif" }),
      new File([new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>")], "a.jpg", { type: "image/jpeg" }),
      new File([new Uint8Array(JPEG)], "a.heic", { type: "image/heic" }),
      new File([], "a.jpg", { type: "image/jpeg" }),
    ];
    for (const f of files) expect((await send(f)).status).toBe(400);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("stores a real JPEG under the seller's folder", async () => {
    const r = await send(new File([new Uint8Array(JPEG)], "listing-photo.jpg", { type: "image/jpeg" }));
    expect(r.status).toBe(200);
    expect(r.body.url).toMatch(/^https:\/\/cdn\/listings\/s1\/\d+\.jpg$/);
  });

  it("refuses a seller awaiting approval (is_active false) before storing anything", async () => {
    storage.upload.mockClear();
    sellerRow = { is_active: false };
    const r = await send(new File([new Uint8Array(JPEG)], "listing-photo.jpg", { type: "image/jpeg" }));
    sellerRow = { is_active: true };
    expect(r).toEqual({ status: 403, body: { error: "Your shop is awaiting approval. Listings open after approval." } });
    expect(storage.upload).not.toHaveBeenCalled();
  });
});
