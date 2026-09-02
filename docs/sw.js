const CACHE_NAME = "clinical-capture-v44";
const APP_SHELL = ["./", "./index.html", "./styles.css?v=28", "./app.js?v=40", "./manifest.webmanifest", "./vendor/sheetjs/xlsx.full.min.js"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  const isAppShell = requestUrl.origin === self.location.origin && /\/(?:index\.html|app\.js|sw\.js)$/.test(requestUrl.pathname);
  const isOcrAsset = requestUrl.origin === self.location.origin && (
    /\/models\/PP-OCRv6_small_.*\.tar$/.test(requestUrl.pathname)
    || /\/vendor\/(?:onnxruntime\/.*\.(?:mjs|wasm)|paddleocr-js\/dist\/.*\.(?:mjs|js)|opencv-js\.mjs)$/.test(requestUrl.pathname)
  );
  if (isAppShell) {
    event.respondWith(fetch(event.request, { cache: "no-store" }).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
      }
      return response;
    }).catch(() => caches.match(event.request)));
    return;
  }
  if (isOcrAsset) {
    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
      }
      return response;
    })));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
