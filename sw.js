const CACHE_NAME = "projeto-financas-v4";
const APP_SHELL = [
  "./", "./index.html", "./inteligencia.html", "./css/styles.css", "./js/app.js", "./js/db.js",
  "./js/utils.js", "./js/parser.js", "./js/charts.js", "./js/inteligencia.js",
  "./js/ai/assistant.js", "./js/ai/intent-router.js", "./js/ai/local-engine.js", "./js/ai/context-builder.js",
  "./js/ai/response-renderer.js", "./js/ai/privacy.js", "./js/ai/validators.js", "./js/ai/online-provider.js",
  "./js/finance/analytics-engine.js", "./js/finance/period-utils.js", "./js/finance/recurring-detector.js",
  "./js/finance/anomaly-detector.js", "./js/finance/budget-engine.js", "./js/finance/projections.js", "./manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.pathname.includes("/api/financial-assistant")) return;
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (!response || !response.ok || response.type !== "basic") return response;
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || (request.mode === "navigate" ? caches.match("./index.html") : undefined)))
  );
});
