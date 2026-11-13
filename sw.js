/* Gelombang – service worker
   Strategi:
   - Halaman (navigasi): network-first, jatuh ke cache bila offline atau terlalu lambat
   - Aset aplikasi, ikon, library CDN: cache-first
   - CSS font Google: stale-while-revalidate
   Naikkan VERSI setiap kali kamu mengubah file aplikasi. */
const VERSI = 'gelombang-v3';

const INTI = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
const LUAR = ['https://cdnjs.cloudflare.com/ajax/libs/jsmediatags/3.9.5/jsmediatags.min.js'];
const HOST_FONT = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const BATAS_JARINGAN = 4000; // ms sebelum halaman diambil dari cache

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSI);
    await c.addAll(INTI);
    await Promise.all(LUAR.map(async (u) => {
      try { await c.add(new Request(u, { mode: 'cors', credentials: 'omit' })); } catch (_) { /* boleh gagal */ }
    }));
    // Sengaja tanpa skipWaiting otomatis: pengguna memilih kapan muat ulang, supaya musik tidak terputus.
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    if (self.registration.navigationPreload) { try { await self.registration.navigationPreload.enable(); } catch (_) {} }
    const kunci = await caches.keys();
    await Promise.all(kunci.filter((k) => k.startsWith('gelombang-') && k !== VERSI).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

// Ambil dari jaringan dengan batas waktu
const jaringan = (req, ms) => new Promise((ok, gagal) => {
  const t = setTimeout(() => gagal(new Error('lambat')), ms);
  fetch(req).then((r) => { clearTimeout(t); ok(r); }, (er) => { clearTimeout(t); gagal(er); });
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'lrclib.net') return; // lirik: langsung ke jaringan, tidak pernah di-cache
  const sama = url.origin === self.location.origin;
  if (!(sama || url.hostname === 'cdnjs.cloudflare.com' || HOST_FONT.includes(url.hostname))) return;

  // 1) Halaman: network-first
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const c = await caches.open(VERSI);
      try {
        const r = (await e.preloadResponse) || (await jaringan(req, BATAS_JARINGAN));
        if (r && r.ok) c.put('./index.html', r.clone());
        return r;
      } catch (_) {
        return (await c.match(req, { ignoreSearch: true })) || (await c.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  // 2) CSS font: stale-while-revalidate
  if (url.hostname === 'fonts.googleapis.com') {
    e.respondWith((async () => {
      const c = await caches.open(VERSI);
      const ada = await c.match(req);
      const baru = fetch(req).then((r) => { if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone()); return r; }).catch(() => null);
      return ada || (await baru) || new Response('', { status: 503 });
    })());
    return;
  }

  // 3) Sisanya: cache-first
  e.respondWith((async () => {
    const c = await caches.open(VERSI);
    const ada = await c.match(req);
    if (ada) return ada;
    try {
      const r = await fetch(req);
      if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone());
      return r;
    } catch (_) {
      return new Response('', { status: 503, statusText: 'Offline' });
    }
  })());
});
