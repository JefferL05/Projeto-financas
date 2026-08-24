const CACHE_NAME="projeto-financas-v2";
const APP_SHELL=["./","./index.html","./inteligencia.html","./css/styles.css","./js/app.js","./js/db.js","./js/utils.js","./js/parser.js","./js/charts.js","./js/inteligencia.js","./manifest.json"];
self.addEventListener("install",event=>{event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(APP_SHELL)));self.skipWaiting()});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE_NAME).map(key=>caches.delete(key)))));self.clients.claim()});
self.addEventListener("fetch",event=>{const request=event.request;if(request.method!=="GET")return;event.respondWith(fetch(request).then(response=>{const copy=response.clone();caches.open(CACHE_NAME).then(cache=>cache.put(request,copy));return response}).catch(()=>caches.match(request).then(cached=>cached||caches.match("./index.html"))))});
