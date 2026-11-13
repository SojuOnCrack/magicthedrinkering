/**
 * CommanderForge service worker
 *
 * Strategy:
 * - App shell: network first, cache fallback
 * - Scryfall proxy: stale while revalidate
 * - Card images: cache first with TTL
 * - Google Fonts: pass through to browser cache
 */

const CACHE_NAME = 'cforge-v15';
const SHELL_CACHE = 'cforge-shell-v15';
const IMAGE_CACHE = 'cforge-images-v15';
const IMAGE_LIMIT = 500;
const IMAGE_TTL = 7 * 24 * 60 * 60 * 1000;
const API_CACHE_LIMIT = 300;
const DEFAULT_API_TTL = 6 * 60 * 60 * 1000;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

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
    event.respondWith(staleWhileRevalidate(request, CACHE_NAME, event));
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

async function staleWhileRevalidate(request, cacheName, event) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const refresh = fetch(request).then(async response => {
    if (response.ok && !/no-store/i.test(response.headers.get('Cache-Control') || '')) {
      const headers = new Headers(response.headers);
      headers.set('x-cforge-cached-at', String(Date.now()));
      const stored = new Response(response.clone().body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
      await cache.put(request, stored);
      await trimCache(cache, API_CACHE_LIMIT);
    }
    return response;
  }).catch(() => null);

  if (cached) {
    const cachedAt = Number(cached.headers.get('x-cforge-cached-at') || 0);
    const cacheControl = cached.headers.get('Cache-Control') || '';
    const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
    const ttl = /no-cache|no-store|must-revalidate/i.test(cacheControl)
      ? 0
      : maxAgeMatch ? Number(maxAgeMatch[1]) * 1000 : DEFAULT_API_TTL;
    const fresh = cachedAt > 0 && Date.now() - cachedAt < ttl;
    if (fresh) {
      event?.waitUntil?.(refresh);
      return cached;
    }
    // Expired entries are refreshed first, but remain available if offline.
    return await refresh ?? cached;
  }
  return await refresh ?? new Response('', { status: 503 });
}

async function trimCache(cache, limit) {
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  await Promise.all(keys.slice(0, keys.length - limit).map(key => cache.delete(key)));
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
    const contentLength = Number(resp.headers.get('Content-Length') || 0);
    if (resp.ok && (!contentLength || contentLength <= MAX_IMAGE_BYTES)) {
      const headers = new Headers(resp.headers);
      headers.set('x-sw-cached-at', String(Date.now()));
      const imageBytes = await resp.arrayBuffer();
      if (imageBytes.byteLength > MAX_IMAGE_BYTES) return cached ?? new Response('', { status: 413 });
      const respWithTs = new Response(imageBytes, {
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

