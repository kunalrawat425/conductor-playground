// reslifih Service Worker
// Handles push notifications and offline app shell caching

const CACHE_NAME = "reslifih-v1";
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
  return `reslifih-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

self.addEventListener("push", (event) => {
  let data = { title: "reslifih", body: "You have an update!", url: "/track" };

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

// Notification click: open the relevant page
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        // Focus existing window if open
        for (const client of clients) {
          if (client.url.includes(url) && "focus" in client) {
            return client.focus();
          }
        }
        // Otherwise open new window
        return self.clients.openWindow(url);
      })
  );
});
