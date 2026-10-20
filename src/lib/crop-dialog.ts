/**
 * Plain-canvas crop step for seller photos (markup: components/ui/molecules/CropDialog.astro).
 * Drag to position, slider to zoom, live preview at the size buyers see. Resolves with a
 * JPEG blob (under the ~300 KB target where possible, never over 5 MB), or null on cancel.
 */
import { CROP, cropRect, MAX_IMAGE_BYTES, TARGET_IMAGE_BYTES, type CropKind } from "./image-crop";

const COPY: Record<CropKind, { title: string; hint: string; preview: string; previewW: number; radius: string }> = {
  logo: { title: "Crop your logo", hint: "Drag to position, use the slider to zoom. Square, shown next to your store name.", preview: "Next to your store name", previewW: 60, radius: "14px" },
  banner: { title: "Crop your store photo", hint: "Drag to position, use the slider to zoom. Phones show the whole frame; wide screens show the part between the dashed lines.", preview: "Top of your store page", previewW: 120, radius: "4px" },
  listing: { title: "Crop your fish photo", hint: "Drag to position, use the slider to zoom. Keep the whole fish inside the square: buyers see exactly this on your menu.", preview: "On your menu", previewW: 64, radius: "8px" },
};

/** JPEG at falling quality until it is under the ~300 KB target; never over the 5 MB cap. */
async function encodeImage(c: HTMLCanvasElement): Promise<Blob | null> {
  let blob: Blob | null = null;
  for (const q of [0.85, 0.75, 0.65, 0.55, 0.45]) {
    blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", q));
    if (!blob || blob.size <= TARGET_IMAGE_BYTES) break;
  }
  return blob && blob.size <= MAX_IMAGE_BYTES ? blob : null;
}

export function cropImage(kind: CropKind, img: HTMLImageElement): Promise<Blob | null> {
  const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const { aspect, outW } = CROP[kind];
  const copy = COPY[kind];
  const modal = byId("p-crop");
  const canvas = byId<HTMLCanvasElement>("p-crop-canvas");
  const preview = byId<HTMLCanvasElement>("p-crop-preview");
  const zoomEl = byId<HTMLInputElement>("p-crop-zoom");
  const okBtn = byId<HTMLButtonElement>("p-crop-ok");
  const errEl = byId("p-crop-error");
  const W = img.naturalWidth, H = img.naturalHeight;
  let zoom = 1, cx = W / 2, cy = H / 2;

  byId("p-crop-title").textContent = copy.title;
  byId("p-crop-hint").textContent = copy.hint;
  byId("p-crop-preview-label").textContent = copy.preview;
  errEl.style.display = "none";
  okBtn.disabled = true;
  zoomEl.value = "1";
  modal.style.display = "flex";

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.width / aspect);
  const pw = copy.previewW;
  preview.style.width = `${pw}px`;
  preview.style.height = `${pw / aspect}px`;
  preview.style.borderRadius = copy.radius;
  preview.width = Math.round(pw * dpr);
  preview.height = Math.round((pw / aspect) * dpr);

  const rect = () => cropRect(W, H, aspect, zoom, cx, cy);
  function draw() {
    const r = rect();
    cx = r.x + r.w / 2; cy = r.y + r.h / 2; // keep the centre clamped so drags don't build up past an edge
    for (const c of [canvas, preview]) c.getContext("2d")!.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
    if (kind === "banner") {
      const ctx = canvas.getContext("2d")!;
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,.9)"; ctx.lineWidth = dpr; ctx.setLineDash([6 * dpr, 4 * dpr]);
      for (const y of [canvas.height / 4, (canvas.height * 3) / 4]) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); }
      ctx.restore();
    }
  }

  let last: { x: number; y: number } | null = null;
  canvas.onpointerdown = (e) => { last = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); };
  canvas.onpointermove = (e) => {
    if (!last) return;
    const scale = rect().w / canvas.clientWidth; // CSS px -> source px
    cx -= (e.clientX - last.x) * scale; cy -= (e.clientY - last.y) * scale;
    last = { x: e.clientX, y: e.clientY };
    draw();
  };
  canvas.onpointerup = canvas.onpointercancel = () => { last = null; };
  zoomEl.oninput = () => { zoom = Number(zoomEl.value); draw(); };

  return new Promise((resolve) => {
    const done = (blob: Blob | null) => { modal.style.display = "none"; resolve(blob); };
    byId<HTMLButtonElement>("p-crop-cancel").onclick = () => done(null);
    modal.onkeydown = (e) => { if (e.key === "Escape") done(null); };
    okBtn.onclick = async () => {
      okBtn.disabled = true;
      const r = rect();
      const out = document.createElement("canvas");
      out.width = Math.min(outW, Math.round(r.w)); // never upscale a small source
      out.height = Math.round(out.width / aspect);
      const ctx = out.getContext("2d")!;
      ctx.fillStyle = "#fff"; // transparent PNGs would turn black as JPEG
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, out.width, out.height);
      const blob = await encodeImage(out);
      if (!blob) {
        errEl.textContent = "Couldn't make this image small enough. Please try another.";
        errEl.style.display = "block";
        okBtn.disabled = false;
        return;
      }
      done(blob);
    };
    draw();
    okBtn.disabled = false; // a valid crop exists from here on
    zoomEl.focus();
  });
}
