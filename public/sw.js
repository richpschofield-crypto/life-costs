// Life Costs service worker — lets the app open with no signal, and shows reminder notifications.
// Bump VERSION whenever app files change so phones pick up the new copy.
const VERSION = 'life-costs-1.0.0';
const FILES = ['./', 'index.html', 'app.js', 'manifest.webmanifest',
               'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('life-costs') && k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Same-site files: answer from the cache straight away, refresh it in the background.

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // The app's server shares this address: only the app's own files are cached, never data.
  const name = url.pathname.split('/').pop();
  if (e.request.mode !== 'navigate' && !FILES.includes(name)) return;
  e.respondWith(caches.open(VERSION).then(async (cache) => {
    const key = e.request.mode === 'navigate' ? './' : e.request;
    const cached = await cache.match(key, { ignoreSearch: true });
    const fresh = fetch(e.request).then((res) => {
      if (res.ok) cache.put(key, res.clone());
      return res;
    }).catch(() => cached);
    return cached || fresh;
  }));
});

// ---- reminder notifications (sent by the Worker at 9am)
self.addEventListener('push', (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { title: 'Life Costs', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(m.title || 'Life Costs', {
    body: m.body || '',
    tag: m.tag || 'life-costs',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    data: { url: m.url || './#reminders' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || './#reminders';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
    const w = wins.find((c) => c.url.startsWith(self.registration.scope));
    if (w) { w.postMessage({ open: 'reminders' }); return w.focus(); }
    return self.clients.openWindow(target);
  }));
});
