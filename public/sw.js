const CACHE_NAME = "north-stand-shell-v2";
const APP_SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/mockup.html",
  "/mockup.css",
  "/mockup.js",
  "/channels.html",
  "/channels.css",
  "/channels.js",
  "/football.html",
  "/pwa.js",
  "/site.webmanifest",
  "/icon.svg",
  "/vendor/lucide.js",
  "/vendor/hls.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) {
    return;
  }
  event.respondWith(
    fetch(request)
      .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(request, copy));
          }
          return response;
      })
      .catch(() =>
        caches.match(request).then(
          (cached) =>
            cached ||
            (request.mode === "navigate"
              ? caches.match("/index.html")
              : Response.error())
        )
      )
  );
});
