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
  if (!id) return json({ error: 'Missing deck id' }, 400);
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(id)) {
    return json({ error: 'Invalid deck id' }, 400);
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
    const target = makeUrl(encodeURIComponent(id));
    try {
      const upstream = await fetch(target, {
        signal: AbortSignal.timeout(10000),
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
      const contentType = upstream.headers.get('Content-Type') || '';
      if (!contentType.toLowerCase().includes('application/json')) {
        lastError = 'Moxfield returned an unexpected content type';
        continue;
      }
      const maxBytes = 5 * 1024 * 1024;
      const contentLength = Number(upstream.headers.get('Content-Length') || 0);
      if (contentLength > maxBytes) {
        return json({ error: 'Moxfield response is too large' }, 502);
      }
      const body = await readLimitedBody(upstream, maxBytes);
      if (body === null) return json({ error: 'Moxfield response is too large' }, 502);
      try {
        JSON.parse(new TextDecoder().decode(body));
      } catch {
        lastError = 'Moxfield returned invalid JSON';
        continue;
      }
      const resp = new Response(body, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=0, s-maxage=900',
          'X-Content-Type-Options': 'nosniff',
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

async function readLimitedBody(response, limit) {
  if (!response.body) return new ArrayBuffer(0);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return merged.buffer;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff', ...corsHeaders() }
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
