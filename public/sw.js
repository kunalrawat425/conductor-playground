// Relifish Service Worker
// Handles push notifications and offline app shell caching

const CACHE_NAME = "relifish-v3";
const SHELL_ASSETS = ["/", "/manifest.json", "/favicon.png", "/icon-192.png", "/badge-96.png"];

// Install: cache app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch: network-first, fall back to cache for app shell
self.addEventListener("fetch", (event) => {
  // Skip non-GET, cross-origin, and API/Supabase requests
  if (
    event.request.method !== "GET" ||
    !event.request.url.startsWith(self.location.origin) ||
    event.request.url.includes("supabase") ||
    event.request.url.includes("/api/")
  ) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful responses for shell assets
        if (response.ok && SHELL_ASSETS.some((a) => event.request.url.endsWith(a))) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          throw new Error("Offline and not cached");
        })
      )
  );
});

// Push notification handler
function uniqueFallbackTag() {
  return `relifish-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

self.addEventListener("push", (event) => {
  let data = { title: "Relifish", body: "You have an update!", url: "/me" };

  if (event.data) {
    try {
      const parsed = event.data.json();
      // If it's a nested FCM payload from Firebase Console or Admin SDK
      if (parsed && (parsed.notification || parsed.data)) {
        data.title = parsed.notification?.title || parsed.data?.title || parsed.title || data.title;
        data.body = parsed.notification?.body || parsed.data?.body || parsed.body || data.body;
        data.url = parsed.data?.url || parsed.data?.path || parsed.notification?.url || parsed.url || data.url;
        if (parsed.data?.tag || parsed.tag) {
          data.tag = parsed.data?.tag || parsed.tag;
        }
      } else {
        // Standard flat payload
        data = { ...data, ...parsed };
      }
    } catch {
      data.body = event.data.text();
    }
  }

  // Never reuse a single tag ("default") — that replaces the previous notification in the OS.
  const tag = typeof data.tag === "string" && data.tag.length > 0 ? data.tag : uniqueFallbackTag();

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192.png",
      badge: "/badge-96.png",
      tag,
      data: { url: data.url },
      vibrate: [200, 100, 200],
      actions: [{ action: "open", title: "View" }],
    })
  );
});

function resolvePushTarget(raw) {
  // BUG-30: was "/v2/track", a route removed when the v2 prefix was dropped —
  // any push without a usable url opened a 404. /me lists the buyer's orders.
  const fallback = "/me";
  const r = (raw && String(raw).trim()) || fallback;
  try {
    if (/^https?:\/\//i.test(r)) return r;
    return new URL(r, self.location.origin).href;
  } catch {
    try {
      return new URL(fallback, self.location.origin).href;
    } catch {
      return r;
    }
  }
}

// Notification click: open the relevant page (absolute URL from server preferred)
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = resolvePushTarget(event.notification.data?.url);

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        let targetUrl;
        try {
          targetUrl = new URL(target);
        } catch {
          return self.clients.openWindow(target);
        }
        for (const client of clients) {
          try {
            const cu = new URL(client.url);
            if (cu.origin !== targetUrl.origin) continue;
            if (cu.pathname === targetUrl.pathname && cu.search === targetUrl.search && "focus" in client) {
              return client.focus();
            }
          } catch {
            /* ignore */
          }
        }
        return self.clients.openWindow(target);
      })
  );
});
