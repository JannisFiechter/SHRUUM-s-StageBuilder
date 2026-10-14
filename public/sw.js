// Service Worker: App-Shell offline verfügbar machen.
// Beim Installieren wird index.html geladen und alle darin referenzierten Assets vorab gecacht.
const VERSION = "v1";
const CACHE = `stagebuilder-${VERSION}`;
const CORE = ["./", "index.html", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(CORE);
      try {
        const html = await (await fetch("index.html", { cache: "no-store" })).text();
        const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css|png|svg|webmanifest|woff2?))"/g)]
          .map((m) => m[1])
          .filter((url) => !/^https?:/.test(url));
        await cache.addAll([...new Set(assets)]);
      } catch {
        /* Assets werden dann beim ersten Abruf gecacht */
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("stagebuilder-") && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Seitenaufrufe: zuerst Netz (für Updates), offline aus dem Cache
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          const cache = await caches.open(CACHE);
          cache.put("index.html", response.clone());
          return response;
        } catch {
          return (await caches.match("index.html")) || (await caches.match("./")) || Response.error();
        }
      })(),
    );
    return;
  }

  // Assets: aus dem Cache, sonst laden und ablegen. Gehashte Dateinamen machen das sicher.
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE);
        cache.put(request, response.clone());
      }
      return response;
    })(),
  );
});
