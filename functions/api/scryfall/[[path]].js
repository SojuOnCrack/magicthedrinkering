/**
 * CommanderForge — Cloudflare Pages Function
 * Scryfall Edge Proxy  /api/scryfall/[...path]
 *
 * Vorteile:
 *  • Cloudflare cached Antworten bis zu 24h am Edge → weniger Rate-Limit-Risiko
 *  • Bulk-Download (~20MB oracle_cards) läuft über Cloudflare CDN, nicht direkt
 *  • User-Agent wird korrekt gesetzt (Scryfall ToS empfiehlt das)
 *  • CORS-Header für alle Origins (da die App selbst hosted wird)
 *
 * Usage im Frontend — tausche  https://api.scryfall.com  gegen  /api/scryfall
 */

const SCRYFALL_BASE = 'https://api.scryfall.com';

// Wie lange jeder Endpunkt gecacht wird (in Sekunden)
const CACHE_TTL = {
  '/cards/autocomplete': 60 * 60 * 12,   // 12h — Kartennamen ändern sich selten
  '/cards/collection':   60 * 60 * 1,    // 1h  — Batch-Preise
  '/cards/search':       60 * 60 * 6,    // 6h
  '/sets':               60 * 60 * 24,   // 24h — Sets ändern sich kaum
  '/bulk-data':          60 * 60 * 24,   // 24h
  default:               60 * 60 * 6,    // 6h  — Fallback
};

function getTTL(pathname) {
  for (const [prefix, ttl] of Object.entries(CACHE_TTL)) {
    if (prefix !== 'default' && pathname.startsWith(prefix)) return ttl;
  }
  return CACHE_TTL.default;
}

export async function onRequest(context) {
  const { request, params } = context;

  // Reconstruct the Scryfall URL from the wildcard path param
  const pathSegments = params.path ?? [];
  const scryfallPath = '/' + (Array.isArray(pathSegments) ? pathSegments.join('/') : pathSegments);
  const originalUrl = new URL(request.url);
  const targetUrl = new URL(SCRYFALL_BASE + scryfallPath + originalUrl.search);

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(),
    });
  }

  // Only allow GET and POST (Scryfall /cards/collection is POST)
  if (!['GET', 'POST'].includes(request.method)) {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const ttl = getTTL(scryfallPath);

  // Build cache key from full URL + method
  const cacheKey = new Request(targetUrl.toString(), { method: request.method });
  const cache = caches.default;

  // Try Cloudflare edge cache first (GET only — POST requests aren't cacheable)
  if (request.method === 'GET') {
    const cached = await cache.match(cacheKey);
    if (cached) {
      const resp = new Response(cached.body, cached);
      resp.headers.set('X-Cache', 'HIT');
      addCorsHeaders(resp.headers);
      return resp;
    }
  }

  // Forward to Scryfall
  const proxyHeaders = {
    'Accept': 'application/json',
    'User-Agent': 'CommanderForge/1.0 (https://github.com/SojuOnCrack/magicthedrinkering)',
  };
  if (request.method === 'POST') {
    proxyHeaders['Content-Type'] = 'application/json';
  }

  let scryfallResp;
  try {
    scryfallResp = await fetch(targetUrl.toString(), {
      method: request.method,
      headers: proxyHeaders,
      body: request.method === 'POST' ? await request.text() : undefined,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Upstream fetch failed', detail: err.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }

  // Pass Scryfall error responses through unchanged
  if (!scryfallResp.ok && scryfallResp.status !== 404) {
    const body = await scryfallResp.text();
    return new Response(body, {
      status: scryfallResp.status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }

  const body = await scryfallResp.arrayBuffer();
  const contentType = scryfallResp.headers.get('Content-Type') ?? 'application/json';

  const response = new Response(body, {
    status: scryfallResp.status,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': `public, max-age=${ttl}, s-maxage=${ttl}`,
      'X-Cache': 'MISS',
      ...corsHeaders(),
    },
  });

  // Store in edge cache (GET only, successful responses)
  if (request.method === 'GET' && scryfallResp.ok) {
    context.waitUntil(cache.put(cacheKey, response.clone()));
  }

  return response;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
  };
}

function addCorsHeaders(headers) {
  for (const [k, v] of Object.entries(corsHeaders())) {
    headers.set(k, v);
  }
}
