import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest as moxfield } from '../functions/api/moxfield/[id].js';
import { onRequest as scryfall } from '../functions/api/scryfall/[[path]].js';

function installCache() {
  const entries = new Map();
  const cache = {
    async match(key) { return entries.get(key.url)?.clone() || null; },
    async put(key, value) { entries.set(key.url, value.clone()); }
  };
  globalThis.caches = { default: cache };
  return entries;
}

function context(url, params = {}, init = {}) {
  const pending = [];
  return {
    request: new Request(url, init),
    params,
    waitUntil(promise) { pending.push(promise); },
    async flush() { await Promise.all(pending); }
  };
}

test('Moxfield rejects malformed IDs before making an upstream request', async t => {
  installCache();
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('must not fetch'); };
  t.after(() => { globalThis.fetch = previousFetch; });
  const ctx = context('https://app.example/api/moxfield/../../secret', { id: '../secret' });
  const response = await moxfield(ctx);
  assert.equal(response.status, 400);
  assert.equal(calls, 0);
});

test('Moxfield validates and returns JSON with cache and security headers', async t => {
  const entries = installCache();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ id: 'deck-1234', name: 'Test deck' }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
  t.after(() => { globalThis.fetch = previousFetch; });
  const ctx = context('https://app.example/api/moxfield/deck-1234', { id: 'deck-1234' });
  const response = await moxfield(ctx);
  await ctx.flush();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).id, 'deck-1234');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.match(response.headers.get('Cache-Control'), /s-maxage=900/);
  assert.equal(entries.size, 1);
});

test('Scryfall rejects traversal segments', async t => {
  installCache();
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('must not fetch'); };
  t.after(() => { globalThis.fetch = previousFetch; });
  const response = await scryfall(context('https://app.example/api/scryfall/../admin', { path: ['..', 'admin'] }));
  assert.equal(response.status, 400);
  assert.equal(calls, 0);
});

test('Scryfall only permits POST on the collection endpoint', async t => {
  installCache();
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('must not fetch'); };
  t.after(() => { globalThis.fetch = previousFetch; });
  const response = await scryfall(context('https://app.example/api/scryfall/cards/search', { path: ['cards', 'search'] }, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: 'test' })
  }));
  assert.equal(response.status, 405);
  assert.equal(calls, 0);
});

test('Scryfall forwards a safe GET and caches only successful JSON', async t => {
  const entries = installCache();
  const previousFetch = globalThis.fetch;
  let requested = '';
  globalThis.fetch = async url => {
    requested = String(url);
    return new Response(JSON.stringify({ data: [{ name: 'Sol Ring' }] }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }
    });
  };
  t.after(() => { globalThis.fetch = previousFetch; });
  const ctx = context('https://app.example/api/scryfall/cards/search?q=sol+ring', { path: ['cards', 'search'] });
  const response = await scryfall(ctx);
  await ctx.flush();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data[0].name, 'Sol Ring');
  assert.match(requested, /api\.scryfall\.com\/cards\/search\?q=sol\+ring/);
  assert.equal(entries.size, 1);
});

test('Scryfall accepts JSON collection POST requests', async t => {
  installCache();
  const previousFetch = globalThis.fetch;
  let sentBody = '';
  globalThis.fetch = async (_url, options) => {
    sentBody = options.body;
    return new Response(JSON.stringify({ data: [], not_found: [] }), {
      headers: { 'Content-Type': 'application/json' }
    });
  };
  t.after(() => { globalThis.fetch = previousFetch; });
  const body = JSON.stringify({ identifiers: [{ name: 'Sol Ring' }] });
  const response = await scryfall(context('https://app.example/api/scryfall/cards/collection', { path: ['cards', 'collection'] }, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  }));
  assert.equal(response.status, 200);
  assert.equal(new TextDecoder().decode(sentBody), body);
});
