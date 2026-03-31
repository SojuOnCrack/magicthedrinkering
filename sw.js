/**
 * CommanderForge service worker
 *
 * Strategy:
 * - App shell: network first, cache fallback
 * - Scryfall proxy: stale while revalidate
 * - Card images: cache first with TTL
 * - Google Fonts: pass through to browser cache
 */

const CACHE_NAME = 'cforge-v13';
const SHELL_CACHE = 'cforge-shell-v13';
const IMAGE_CACHE = 'cforge-images-v13';
const IMAGE_LIMIT = 500;
const IMAGE_TTL = 7 * 24 * 60 * 60 * 1000;

const SHELL_FILES = ['/index.html', '/manifest.json'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  const keep = new Set([CACHE_NAME, SHELL_CACHE, IMAGE_CACHE]);
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => !keep.has(key)).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  if (url.hostname.includes('scryfall.io') || url.hostname.includes('cards.scryfall.io')) {
    event.respondWith(cacheFirstImages(request));
    return;
  }

  if (url.pathname.startsWith('/api/scryfall')) {
    event.respondWith(staleWhileRevalidate(request, CACHE_NAME));
    return;
  }

  if (
    url.origin === self.location.origin &&
    (url.pathname === '/' || url.pathname === '/index.html' || !url.pathname.includes('.'))
  ) {
    event.respondWith(networkFirstShell(request));
    return;
  }

  if (url.hostname.includes('fonts.gstatic.com') || url.hostname.includes('fonts.googleapis.com')) {
    return;
  }

  if (url.hostname.includes('supabase.co')) return;

  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request, CACHE_NAME));
  }
});

async function networkFirstShell(request) {
  try {
    const networkResp = await fetch(request);
    if (networkResp.ok) {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(request, networkResp.clone());
    }
    return networkResp;
  } catch {
    const cached = await caches.match('/index.html', { cacheName: SHELL_CACHE });
    return cached ?? new Response('Offline - please reconnect to the internet.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then(resp => {
      if (resp.ok) cache.put(request, resp.clone());
      return resp;
    })
    .catch(() => null);
  return cached ?? await fetchPromise ?? new Response('', { status: 503 });
}

async function cacheFirstImages(request) {
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(request);

  if (cached) {
    const cachedDate = cached.headers.get('x-sw-cached-at');
    if (cachedDate && Date.now() - Number(cachedDate) < IMAGE_TTL) {
      return cached;
    }
  }

  try {
    const resp = await fetch(request);
    if (resp.ok) {
      const headers = new Headers(resp.headers);
      headers.set('x-sw-cached-at', String(Date.now()));
      const respWithTs = new Response(await resp.arrayBuffer(), {
        status: resp.status,
        headers
      });
      await evictOldImages(cache);
      await cache.put(request, respWithTs.clone());
      return respWithTs;
    }
    return resp;
  } catch {
    return cached ?? new Response('', { status: 503 });
  }
}

async function evictOldImages(cache) {
  const keys = await cache.keys();
  if (keys.length >= IMAGE_LIMIT) {
    const toDelete = keys.slice(0, 50);
    await Promise.all(toDelete.map(key => cache.delete(key)));
  }
}

