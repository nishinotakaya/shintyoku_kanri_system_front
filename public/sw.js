// 最小構成の Service Worker (PWAインストール要件用)。
// API はネットワーク直行、静的アセットのみ stale-while-revalidate でキャッシュする。
const CACHE = 'kintai-static-v1'

self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  // API・別オリジン・非GETはキャッシュしない
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api')) return
  // ビルド済みアセット(ハッシュ付き)のみキャッシュ
  if (!url.pathname.startsWith('/assets/') && !url.pathname.match(/\.(png|svg|webmanifest)$/)) return
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(event.request)
      const fetched = fetch(event.request).then((res) => {
        if (res.ok) cache.put(event.request, res.clone())
        return res
      }).catch(() => cached)
      return cached || fetched
    })
  )
})
