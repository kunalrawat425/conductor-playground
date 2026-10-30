// Full-screen fireworks with sound (fireworks-js, MIT), loaded only when fired.
// Pages call window.relifishFireworks() (set up in AppShell) after a tap, e.g. on checkout or order placed.

const SOUNDS = [0, 1, 2].map((n) => `/sounds/explosion${n}.mp3`);

/** Browsers only play audio after the user has tapped something on this page. */
export function canPlaySound(): boolean {
  const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  return ua ? ua.hasBeenActive : true;
}

/** Fireworks over the whole page for `durationMs`, then fade out. Resolves when done; no-op for reduced motion. */
export async function celebrate(durationMs = 3000): Promise<void> {
  if (typeof window === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const box = document.createElement("div");
  box.setAttribute("aria-hidden", "true");
  box.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:9999";
  document.body.appendChild(box);
  try {
    const { Fireworks } = await import("fireworks-js");
    const fw = new Fireworks(box, {
      acceleration: 1.04, friction: 0.97, gravity: 1.5, particles: 90, explosion: 6, intensity: 38,
      flickering: 50, lineStyle: "round", hue: { min: 0, max: 360 }, rocketsPoint: { min: 15, max: 85 },
      brightness: { min: 55, max: 85 }, decay: { min: 0.015, max: 0.03 },
      sound: { enabled: canPlaySound(), files: SOUNDS, volume: { min: 3, max: 7 } },
    });
    fw.start();
    await new Promise((r) => setTimeout(r, durationMs));
    await fw.waitStop(true);
  } finally {
    box.remove();
  }
}
