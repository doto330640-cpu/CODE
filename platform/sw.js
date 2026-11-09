/* 오프라인에서도 열리도록 앱 파일과 데이터를 캐시한다. 데이터는 네트워크 우선, 나머지는 캐시 우선. */
const V = 'ecm-v2';
const FILES = ['./', 'index.html', 'styles.css', 'app.js', 'data/courses.json', 'data/sensors.json', 'data/drone.json', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  '../brand/fonts/Pretendard-Regular.otf', '../brand/fonts/Pretendard-Medium.otf', '../brand/fonts/Pretendard-Bold.otf', '../brand/fonts/Pretendard-ExtraBold.otf'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const isData = e.request.url.includes('/data/');
  e.respondWith(isData
    ? fetch(e.request).then((r) => { const c = r.clone(); caches.open(V).then((x) => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request))
    : caches.match(e.request).then((r) => r || fetch(e.request)));
});
