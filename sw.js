/* Gelombang – service worker
   Strategi: cache-first untuk aset aplikasi, library CDN, dan font.
   Naikkan VERSI setiap kali Anda mengubah file aplikasi agar cache lama diganti. */
const VERSI = 'gelombang-v2';

// Aset inti: wajib berhasil di-cache saat pemasangan
const INTI = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];
// Aset luar (cdnjs, versi dipin): dicoba di-cache, kegagalan tidak membatalkan pemasangan
const LUAR = [
  'https://cdnjs.cloudflare.com/ajax/libs/jsmediatags/3.9.5/jsmediatags.min.js'
];
const HOST_FONT = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSI);
    await c.addAll(INTI);
    await Promise.all(LUAR.map(async (u) => {
      try { await c.add(new Request(u, { mode: 'cors', credentials: 'omit' })); } catch (_) { /* abaikan */ }
    }));
    // Tidak memanggil skipWaiting otomatis: pengguna memilih kapan memuat ulang (agar musik tidak terputus)
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const kunci = await caches.keys();
    await Promise.all(kunci.filter((k) => k.startsWith('gelombang-') && k !== VERSI).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // LRCLIB (lirik): selalu langsung ke jaringan, tidak pernah di-cache oleh service worker.
  // Lirik yang sudah diambil disimpan aplikasi di IndexedDB; saat offline aplikasi memakai lirik tersimpan.
  if (url.hostname === 'lrclib.net') return;
  const sama = url.origin === self.location.origin;
  const dikenal = sama || url.hostname === 'cdnjs.cloudflare.com' || HOST_FONT.includes(url.hostname);
  if (!dikenal) return; // permintaan lain dibiarkan apa adanya

  // Navigasi: selalu kembalikan cangkang aplikasi (jalan offline)
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const c = await caches.open(VERSI);
      const ada = (await c.match(req, { ignoreSearch: true })) || (await c.match('./index.html'));
      if (ada) return ada;
      try { return await fetch(req); } catch (_) { return (await c.match('./index.html')) || Response.error(); }
    })());
    return;
  }

  e.respondWith((async () => {
    const c = await caches.open(VERSI);
    const ada = await c.match(req);
    if (ada) {
      // CSS font: segarkan diam-diam di latar belakang
      if (url.hostname === 'fonts.googleapis.com') {
        e.waitUntil(fetch(req).then((r) => { if (r && (r.ok || r.type === 'opaque')) c.put(req, r); }).catch(() => {}));
      }
      return ada;
    }
    try {
      const r = await fetch(req);
      if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone());
      return r;
    } catch (_) {
      return new Response('', { status: 503, statusText: 'Offline' });
    }
  })());
});
