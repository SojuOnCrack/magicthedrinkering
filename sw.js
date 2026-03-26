/**
 * CommanderForge — Service Worker
 * Strategie:
 *  • App-Shell (index.html)  → Network-first, Cache-fallback
 *  • Scryfall-Proxy (/api/)  → Stale-while-revalidate
 *  • Kartenbilder (scryfall.io) → Cache-first (bis zu 7 Tage)
 *  • Google Fonts             → Cache-first (30 Tage)
 */

const CACHE_NAME   = 'cforge-v2';
const SHELL_CACHE  = 'cforge-shell-v2';
const IMAGE_CACHE  = 'cforge-images-v2';
const IMAGE_LIMIT  = 500;   // max gecachte Bilder
const IMAGE_TTL    = 7 * 24 * 60 * 60 * 1000;   // 7 Tage in ms

// App-Shell Dateien — werden beim Install gecacht
const SHELL_FILES = ['/index.html', '/manifest.json'];

// ──────────────────────────────────────────────────
//  Install: App-Shell vorab cachen
// ──────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

// ──────────────────────────────────────────────────
//  Activate: alte Caches löschen
// ──────────────────────────────────────────────────
self.addEventListener('activate', event => {
  const keep = new Set([CACHE_NAME, SHELL_CACHE, IMAGE_CACHE]);
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !keep.has(k)).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ──────────────────────────────────────────────────
//  Fetch: Routing-Logik
// ──────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Nicht-GET-Requests immer durchlassen (Supabase Schreiboperationen etc.)
  if (request.method !== 'GET') return;

  // ① Kartenbilder von Scryfall — Cache-first (7 Tage)
  if (url.hostname.includes('scryfall.io') || url.hostname.includes('cards.scryfall.io')) {
    event.respondWith(cacheFirstImages(request));
    return;
  }

  // ② Scryfall Edge-Proxy — Stale-while-revalidate
  if (url.pathname.startsWith('/api/scryfall')) {
    event.respondWith(staleWhileRevalidate(request, CACHE_NAME));
    return;
  }

  // ③ App-Shell (index.html, /) — Network-first mit Fallback
  if (url.origin === self.location.origin &&
      (url.pathname === '/' || url.pathname === '/index.html' ||
       !url.pathname.includes('.'))) {
    event.respondWith(networkFirstShell(request));
    return;
  }

  // ④ Google Fonts — kein SW-Cache (CSP: connect-src blockiert fetch() aus SW)
  //    Browser-HTTP-Cache übernimmt das Caching automatisch.
  if (url.hostname.includes('fonts.gstatic.com') || url.hostname.includes('fonts.googleapis.com')) {
    return; // pass-through, kein SW-Eingriff
  }

  // ⑤ Supabase-Requests (Auth, DB) — immer Network, kein Cache
  if (url.hostname.includes('supabase.co')) return;

  // ⑥ Sonstige lokale Assets — Stale-while-revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request, CACHE_NAME));
  }
});

// ──────────────────────────────────────────────────
//  Strategie-Funktionen
// ──────────────────────────────────────────────────

async function networkFirstShell(request) {
  try {
    const networkResp = await fetch(request);
    if (networkResp.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, networkResp.clone());
    }
    return networkResp;
  } catch {
    const cached = await caches.match('/index.html', { cacheName: SHELL_CACHE });
    return cached ?? new Response('Offline — bitte Internet verbinden.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then(resp => {
    if (resp.ok) cache.put(request, resp.clone());
    return resp;
  }).catch(() => null);
  return cached ?? await fetchPromise ?? new Response('', { status: 503 });
}

async function cacheFirstImages(request) {
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(request);

  if (cached) {
    // TTL-Check: zu alte Bilder neu laden
    const cachedDate = cached.headers.get('x-sw-cached-at');
    if (cachedDate && Date.now() - Number(cachedDate) < IMAGE_TTL) {
      return cached;
    }
  }

  try {
    const resp = await fetch(request);
    if (resp.ok) {
      // Eigenen Timestamp-Header hinzufügen (Response-Headers sind immutable → neu bauen)
      const headers = new Headers(resp.headers);
      headers.set('x-sw-cached-at', String(Date.now()));
      const respWithTs = new Response(await resp.arrayBuffer(), { status: resp.status, headers });
      await evictOldImages(cache);
      cache.put(request, respWithTs.clone());
      return respWithTs;
    }
    return resp;
  } catch {
    return cached ?? new Response('', { status: 503 });
  }
}

// cacheFirstFonts entfernt — Fonts werden nicht vom SW gecacht
// (CSP connect-src blockiert fetch() auf externe Domains aus dem SW-Kontext)

// Älteste Bilder löschen wenn Limit erreicht
async function evictOldImages(cache) {
  const keys = await cache.keys();
  if (keys.length >= IMAGE_LIMIT) {
    // Einfache FIFO: älteste 50 löschen
    const toDelete = keys.slice(0, 50);
    await Promise.all(toDelete.map(k => cache.delete(k)));
  }
}
