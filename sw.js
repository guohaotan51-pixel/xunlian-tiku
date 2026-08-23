/* 询练 PWA service worker
 * 策略：network-first（在线永远取最新版本，离线回退缓存）+
 * 版本号递增 + 新 SW 激活后自动刷新旧页面，从而解决“网上已更新、手机仍是旧版”的问题。
 */
const CACHE = 'xunlian-v3';
const ASSETS = [
  './index.html',
  './styles.css',
  './app.js',
  './bank-data.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
    // 新版本生效时，刷新已打开/已安装的页面，让它们立刻拿到新资源
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach((c) => { c.navigate(c.url).catch(() => {}); });
  })());
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  // network-first
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((cached) => {
        if (cached) return cached;
        // 导航请求离线时回退到缓存的首页
        if (e.request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      }))
  );
});
