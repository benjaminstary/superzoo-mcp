import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHttpServer } from '../dist/http.js';
import { readConfig } from '../dist/config.js';
import { SuperzooClient } from '../dist/client.js';

function rawRequest(url, options) {
  return new Promise((resolve, reject) => {
    const req = request(url, options, res => {
      res.resume();
      res.once('end', () => resolve({ status: res.statusCode, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));
async function start(t, env = {}) {
  const config = readConfig({ SUPERZOO_COUNTRY: 'CZ', SUPERZOO_TRANSPORT: 'http', ...env });
  const detail = fixture('product-detail');
  const api = new SuperzooClient({ country: config.country, fetchImpl: async url => {
    if (String(url).includes('full-text-search')) return new Response(JSON.stringify(fixture('filtered-search')));
    if (String(url).endsWith('/availability')) return new Response(JSON.stringify(fixture('store-availability')));
    return new Response(JSON.stringify({ ...detail, price: { ...detail.price, sellPrice: '359' } }));
  } });
  const server = createHttpServer({ config, client: api });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); }));
  return new URL(`http://127.0.0.1:${server.address().port}/mcp`);
}

test('HTTP initializes and calls all tools without a bearer token; concurrent clients stay independent', async t => {
  const url = await start(t);
  await Promise.all([1, 2].map(async n => {
    const client = new Client({ name: `http-test-${n}`, version: '1.0.0' });
    t.after(() => client.close());
    await client.connect(new StreamableHTTPClientTransport(url));
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 5);
    assert.match(tools.tools.find(x => x.name === 'get_product').description, /CZK/);
    const product = await client.callTool({ name: 'get_product', arguments: { product_id: '294-101115' } });
    assert.equal(product.structuredContent.market, 'CZ');
    assert.equal(product.structuredContent.price.currency, 'CZK');
    const search = await client.callTool({ name: 'search_products', arguments: { query: 'brit', limit: 1 } });
    assert.equal(search.structuredContent.products[0].product_id, '294-101115');
    const stock = await client.callTool({ name: 'get_product_availability', arguments: { product_id: '294-101115', city: 'Bratislava' } });
    assert.ok(stock.structuredContent.stores.length > 0);
    const bad = await client.callTool({ name: 'get_product', arguments: { product_id: '../users' } });
    assert.equal(bad.isError, true);
  }));
});

test('HTTP rejects untrusted hosts/origins, wrong methods, malformed and oversized bodies', async t => {
  const url = await start(t);
  assert.equal((await rawRequest(url, { method: 'POST', headers: { Host: 'evil.example' } })).status, 403);
  assert.equal((await fetch(url, { method: 'POST', headers: { Origin: 'https://evil.example' }, body: '{}' })).status, 403);
  assert.equal((await fetch(url)).status, 405);
  assert.equal((await fetch(url, { method: 'DELETE' })).status, 405);
  assert.equal((await fetch(new URL('/unknown', url))).status, 404);
  assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 415);
  assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(70_000) })).status, 413);
  const chunkedStatus = await new Promise((resolve, reject) => {
    const req = request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    req.write('x'.repeat(70_000));
    req.end();
  });
  assert.equal(chunkedStatus, 413);
});

test('HTTP explicitly allows configured origins and hostnames, with CORS for browser clients', async t => {
  const url = await start(t, { SUPERZOO_ALLOWED_HOSTS: 'mcp.example.com', SUPERZOO_ALLOWED_ORIGINS: 'https://client.example.com' });
  const response = await rawRequest(url, { method: 'OPTIONS', headers: { Host: 'mcp.example.com', Origin: 'https://client.example.com',
    'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,mcp-protocol-version' } });
  assert.equal(response.status, 204);
  assert.equal(response.headers['access-control-allow-origin'], 'https://client.example.com');
  assert.match(response.headers['access-control-allow-headers'], /mcp-protocol-version/i);
});

function toolRequest(url, id) {
  const req = request(url, { method: 'POST', headers: {
    'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
  } });
  const result = new Promise((resolve, reject) => {
    req.once('response', response => {
      let text = '';
      response.on('data', chunk => { text += chunk; });
      response.once('end', () => resolve(JSON.parse(text)));
      response.once('error', reject);
    });
    req.once('error', reject);
  });
  // A disconnected request is expected to reject before a response exists.
  result.catch(() => {});
  req.end(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call',
    params: { name: 'get_product', arguments: { product_id: '294-101115' } } }));
  return { req, result };
}

async function waitUntil(predicate) {
  const deadline = Date.now() + 1500;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'Timed out waiting for protocol event');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

for (const shared of [false, true]) {
  test(`HTTP disconnect cancels caller while ${shared ? 'preserving another shared lookup' : 'aborting unneeded upstream work'}`, { timeout: 4000 }, async t => {
    let upstreamSignal;
    let finish;
    let fetches = 0;
    const api = new SuperzooClient({ fetchImpl: async (_url, init) => {
      fetches++;
      upstreamSignal = init.signal;
      return new Promise(resolve => { finish = () => resolve(new Response(JSON.stringify(fixture('product-detail')))); });
    } });
    const callerSignals = [];
    const getProduct = api.getProduct.bind(api);
    api.getProduct = (input, context) => {
      callerSignals.push(context?.signal);
      return getProduct(input, context);
    };
    const server = createHttpServer({ client: api });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => { server.closeAllConnections(); server.close(); });
    const url = new URL(`http://127.0.0.1:${server.address().port}/mcp`);
    const first = toolRequest(url, 1);
    await waitUntil(() => upstreamSignal);
    // A completed incoming body must leave its tool handler running.
    assert.equal(upstreamSignal.aborted, false);
    let second;
    if (shared) {
      second = toolRequest(url, 2);
      await waitUntil(() => callerSignals.length === 2);
    }
    first.req.destroy();
    await waitUntil(() => callerSignals[0]?.aborted);
    if (shared) {
      assert.equal(upstreamSignal.aborted, false);
      assert.equal(callerSignals[1].aborted, false);
      finish();
      const response = await second.result;
      assert.equal(response.result.structuredContent.product_id, '294-101115');
      assert.equal(fetches, 1);
    } else {
      await waitUntil(() => upstreamSignal.aborted);
    }
  });
}
