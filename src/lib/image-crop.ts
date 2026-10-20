/**
 * Crop maths for the seller logo / store photo upload (dashboard profile).
 * Aspects match where buyers see each image:
 *  - logo: the square avatar next to the store name (SellerHero .v2-sh-avatar, cart avatars).
 *  - banner: SellerHero banner, full app width x 260px. On a 390px phone that is 1.5:1,
 *    so 3:2. Wider screens (up to the 800px app width, ~3:1) show about the middle half.
 *  - listing: the square photo on each buyer menu card (and the seller cards on /shop).
 */
export const CROP = {
  logo: { aspect: 1, outW: 512, minW: 200, minH: 200 },
  banner: { aspect: 1.5, outW: 1500, minW: 800, minH: 0 },
  listing: { aspect: 1, outW: 800, minW: 400, minH: 400 },
} as const;
export type CropKind = keyof typeof CROP;

export type Rect = { x: number; y: number; w: number; h: number };

/**
 * Source-pixel rect for an image of w x h, cropped at `aspect` (width / height).
 * zoom 1 = largest rect that fits; (cx, cy) = wanted centre, clamped so the rect stays inside.
 */
export function cropRect(w: number, h: number, aspect: number, zoom: number, cx: number, cy: number): Rect {
  const cw = Math.min(w, h * aspect) / Math.max(1, zoom);
  const ch = cw / aspect;
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
  return { x: clamp(cx - cw / 2, w - cw), y: clamp(cy - ch / 2, h - ch), w: cw, h: ch };
}

/** Upload size cap (the API enforces the same). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Target for the cropped export; it is re-encoded at lower quality until it fits. */
export const TARGET_IMAGE_BYTES = 300 * 1024;
const OK_TYPES = ["image/jpeg", "image/png", "image/webp"];
const OK_EXT = /\.(jpe?g|png|webp)$/i;

/** Picked file check before the crop opens. Returns an error to show, or null. */
export function imageFileError(file: { name: string; type: string; size: number }): string | null {
  if (!OK_TYPES.includes(file.type) || !OK_EXT.test(file.name)) {
    return "Please choose a JPEG, PNG or WebP image (HEIC, GIF and SVG aren't supported).";
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return `This image is ${(file.size / 1024 / 1024).toFixed(1)} MB. Please choose one under 5 MB.`;
  }
  return null;
}

/** Source resolution check once the image has loaded. Returns an error to show, or null. */
export function imageDimensionsError(kind: CropKind, w: number, h: number): string | null {
  const { minW, minH } = CROP[kind];
  if (w >= minW && h >= minH) return null;
  return minH > 0
    ? `Image too small: use at least ${minW}×${minH} px (this one is ${w}×${h}).`
    : `Image too small: use at least ${minW} px wide (this one is ${w} px).`;
}
