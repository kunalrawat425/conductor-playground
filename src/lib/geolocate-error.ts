/**
 * Why "Use current location" failed, in words a buyer can act on. The browser only shows its
 * permission popup while the site's permission is still "ask"; once it is blocked (denied before,
 * or auto-blocked after a few dismissed prompts) or the phone's GPS is off, getCurrentPosition
 * fails at once with no popup. In-app browsers (Instagram, Facebook, WhatsApp) often can't share it.
 */
export function geolocateErrorMessage(code: number | undefined, userAgent = ""): { title: string; body: string } {
  if (/Instagram|FBAN|FBAV|WhatsApp/i.test(userAgent))
    return { title: "Location isn't available in this app", body: "Type your area, or open relifish.com in Chrome to use your location." };
  if (code === 1)
    return { title: "Location is blocked for Relifish", body: "Tap the 🔒 next to the web address → Permissions → Location → Allow. Or type your area." };
  if (code === 2)
    return { title: "Couldn't find your location", body: "Turn on your phone's location (GPS) and try again, or type your area." };
  return { title: "Location took too long", body: "Try again, or type your area." };
}

/** Options for every "use my location" tap: a coarse fix is enough for an area, and never wait forever. */
export const GEO_OPTIONS: PositionOptions = { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 };
