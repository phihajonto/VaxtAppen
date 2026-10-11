// Växtvakten service worker: visar pushnotiser och gör att appen startar utan nät.
// Byt versionen här och i index.html (?v=…) när appen ändras.
const CACHE = "vaxtvakten-v7";
const SHELL = ["./", "index.html", "styles.css?v=7", "app.js?v=7", "config.js?v=7", "manifest.webmanifest", "icons/icon-192.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Network first for the app's own files, so updates show up right away; cache as fallback offline.
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    // "no-cache" asks the server whether the file changed instead of using the browser's copy,
    // so a new index.html is never paired with an old app.js.
    fetch(e.request.mode === "navigate" ? e.request.url : e.request, { cache: "no-cache" }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match("index.html")))
  );
});

self.addEventListener("push", e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data && e.data.text() }; }
  const title = data.title || "Dags att vattna";
  const body = data.body || "Öppna Växtvakten för att se vilka växter som behöver vatten.";
  // A push that doesn't end in a visible notification counts as "silent" on iPhone, and after a few
  // of those iOS quietly turns notifications off for the app. If the full options are rejected,
  // fall back to the simplest possible notification so one is always shown.
  e.waitUntil(
    self.registration.showNotification(title, {
      body, icon: "icons/icon-192.png", badge: "icons/badge-96.png", tag: data.tag || "vaxtvakten-daily",
    }).catch(() => self.registration.showNotification(title, { body }))
  );
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) if ("focus" in c) return c.focus();
    return self.clients.openWindow("./");
  }));
});
