const CANDIDATE_ENDPOINTS = [
  id => `https://api2.moxfield.com/v3/decks/all/${id}`,
  id => `https://api2.moxfield.com/v2/decks/all/${id}`,
  id => `https://api2.moxfield.com/v3/decks/${id}`,
  id => `https://api2.moxfield.com/v2/decks/${id}`
];

export async function onRequest(context) {
  const { request, params } = context;
  const id = params.id;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders() });
  }
  if (!id) {
    return json({ error: 'Missing deck id' }, 400);
  }

  const cache = caches.default;
  const cacheKey = new Request(new URL(request.url).toString(), { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) {
    const resp = new Response(cached.body, cached);
    addCorsHeaders(resp.headers);
    resp.headers.set('X-Cache', 'HIT');
    return resp;
  }

  let lastError = 'Deck not found';
  for (const makeUrl of CANDIDATE_ENDPOINTS) {
    const target = makeUrl(id);
    try {
      const upstream = await fetch(target, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'CommanderForge/1.0',
          'Origin': 'https://www.moxfield.com',
          'Referer': 'https://www.moxfield.com/'
        }
      });
      if (!upstream.ok) {
        lastError = `HTTP ${upstream.status}`;
        continue;
      }
      const body = await upstream.arrayBuffer();
      const resp = new Response(body, {
        status: 200,
        headers: {
          'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
          'Cache-Control': 'public, max-age=900, s-maxage=900',
          ...corsHeaders()
        }
      });
      context.waitUntil(cache.put(cacheKey, resp.clone()));
      return resp;
    } catch (err) {
      lastError = err.message || 'Upstream fetch failed';
    }
  }

  return json({ error: lastError }, 502);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept'
  };
}

function addCorsHeaders(headers) {
  Object.entries(corsHeaders()).forEach(([k, v]) => headers.set(k, v));
}
