/**
 * Accept only real JPEG / PNG / WebP uploads, judged by their bytes — not the
 * client-declared type or filename. Uploads go to public buckets, so an
 * accepted .svg / .html file would be served from our storage domain.
 * Returns the extension to store under, or null to reject.
 */
export async function imageExtension(file: File): Promise<"jpg" | "png" | "webp" | null> {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "webp";
  return null;
}

export const IMAGE_MIME = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;
