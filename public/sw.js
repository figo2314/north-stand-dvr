const CACHE_NAME = "north-stand-shell-v30";
const APP_SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/ui.css",
  "/app.js",
  "/mockup.html",
  "/mockup.css",
  "/mockup.js",
  "/channels.html",
  "/channels.css",
  "/channels.js",
  "/music.js",
  "/football.html",
  "/audio/the-angel-north-london-forever.m4a",
  "/audio/north-london-forever-2.mp3",
  "/images/home-arsenal-trophy.webp",
  "/images/home-arsenal-champions-poster.webp",
  "/images/home-arsenal-champions-squad.webp",
  "/images/home-arsenal-ribbon-trophy.webp",
  "/images/home-arsenal-confetti-celebration.webp",
  "/images/home-arsenal-red-confetti.webp",
  "/images/home-arsenal-legends-trophy.webp",
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
