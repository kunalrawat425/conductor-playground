// Relifish Service Worker
// Handles push notifications and offline app shell caching

const CACHE_NAME = "relifish-v1";
const SHELL_ASSETS = ["/", "/manifest.json", "/favicon.svg"];

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
  // Skip non-GET and API/Supabase requests
  if (
    event.request.method !== "GET" ||
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
      .catch(() => caches.match(event.request))
  );
});

// Push notification handler
function uniqueFallbackTag() {
  return `relifish-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

self.addEventListener("push", (event) => {
  let data = { title: "Relifish", body: "You have an update!", url: "/v2/track" };

  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
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
      badge: "/icon-192.png",
      tag,
      data: { url: data.url },
      vibrate: [200, 100, 200],
      actions: [{ action: "open", title: "View" }],
    })
  );
});

function resolvePushTarget(raw) {
  const fallback = "/v2/track";
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
