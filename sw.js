const CACHE_NAME = "projeto-financas-v7";

const APP_SHELL = [
  "./",
  "./index.html",
  "./inteligencia.html",
  "./gestao.html",
  "./offline.html",
  "./manifest.json",
  "./css/styles.css",
  "./css/gestao.css",
  "./css/v2.css",
  "./css/inteligencia.css",
  "./js/app.js",
  "./js/gestao.js",
  "./js/db.js",
  "./js/utils.js",
  "./js/parser.js",
  "./js/charts.js",
  "./js/inteligencia.js",
  "./js/ai/assistant.js",
  "./js/ai/intent-router.js",
  "./js/ai/local-engine.js",
  "./js/ai/context-builder.js",
  "./js/ai/response-renderer.js",
  "./js/ai/privacy.js",
  "./js/ai/validators.js",
  "./js/ai/online-provider.js",
  "./js/finance/analytics-engine.js",
  "./js/finance/period-utils.js",
  "./js/finance/date-utils.js",
  "./js/finance/exchange.js",
  "./js/finance/recurring-detector.js",
  "./js/finance/anomaly-detector.js",
  "./js/finance/budget-engine.js",
  "./js/finance/projections.js",
  "./js/accounts/account-service.js",
  "./js/accounts/account-balance.js",
  "./js/accounts/transfers.js",
  "./js/accounts/reconciliation.js",
  "./js/transactions/schedules.js",
  "./js/transactions/installments.js",
  "./js/rules/rules-engine.js",
  "./js/reports/report-engine.js",
  "./js/data/backup-service.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const url of APP_SHELL) {
        try {
          await cache.add(url);
        } catch {
          // Um recurso opcional não deve impedir a instalação da PWA inteira.
        }
      }
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

function isSensitiveOrExternal(url) {
  return url.pathname.includes("/api/financial-assistant")
    || url.pathname.includes("/api/")
    || url.origin !== self.location.origin;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (isSensitiveOrExternal(url)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response?.ok && response.type === "basic") {
            caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
          }
          return response;
        })
        .catch(async () => {
          return (await caches.match(request))
            || (await caches.match("./offline.html"));
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (!response || !response.ok || response.type !== "basic") return response;
        caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
        return response;
      });
    })
  );
});
