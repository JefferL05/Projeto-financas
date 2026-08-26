const CACHE_NAME = "projeto-financas-v10";

const APP_SHELL = [
  "./",
  "./index.html",
  "./inteligencia.html",
  "./gestao.html",
  "./offline.html",
  "./manifest.json",
  "./assets/icons/icon-192.svg",
  "./assets/icons/icon-512.svg",
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
  "./js/ai/account-context.js",
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

const SENSITIVE_PATHS = ["/api/financial-assistant", "/api/"];

function isSensitiveOrExternal(url) {
  return url.origin !== self.location.origin
    || SENSITIVE_PATHS.some((path) => url.pathname.includes(path));
}

async function cacheShell() {
  const cache = await caches.open(CACHE_NAME);
  const results = await Promise.allSettled(
    APP_SHELL.map(async (url) => {
      const response = await fetch(url, { cache: "no-cache" });
      if (!response.ok) throw new Error(`Falha ao pré-carregar ${url}: ${response.status}`);
      await cache.put(url, response);
    })
  );

  const critical = new Set([
    "./index.html",
    "./css/styles.css",
    "./js/app.js",
    "./js/db.js",
    "./js/utils.js",
    "./offline.html"
  ]);

  const failures = results
    .map((result, index) => ({ result, url: APP_SHELL[index] }))
    .filter(({ result, url }) => critical.has(url) && result.status === "rejected");

  if (failures.length) {
    throw new Error(`Falha ao instalar recursos essenciais: ${failures.map((item) => item.url).join(", ")}`);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheShell());
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
            event.waitUntil(
              caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()))
            );
          }
          return response;
        })
        .catch(async () => (await caches.match(request)) || caches.match("./offline.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(async (cached) => {
      if (cached) return cached;

      const response = await fetch(request);
      if (response?.ok && response.type === "basic") {
        event.waitUntil(
          caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()))
        );
      }
      return response;
    })
  );
});
