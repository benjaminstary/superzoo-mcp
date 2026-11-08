import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../dist/server.js';
import { SuperzooClient } from '../dist/client.js';
import { readFileSync } from 'node:fs';

const detail = JSON.parse(readFileSync(new URL('./fixtures/product-detail.json', import.meta.url)));

test('MCP exposes five read-only tools, validates input and returns structured price data', async t => {
  const server = createServer(new SuperzooClient({ fetchImpl: async () => new Response(JSON.stringify(detail)) }));
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  t.after(async () => { await client.close(); await server.close(); });
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name).sort(), ['compare_products', 'find_common_stores', 'get_product', 'get_product_availability', 'search_products']);
  assert.ok(tools.every(tool => tool.outputSchema?.type === 'object'));
  assert.ok(tools.find(tool => tool.name === 'search_products').inputSchema.properties.online_only);
  assert.ok(tools.every(tool => tool.annotations.readOnlyHint && !tool.annotations.destructiveHint));
  const result = await client.callTool({ name: 'get_product', arguments: { product_id: '294-101115' } });
  assert.equal(result.structuredContent.price.amount, '13.99');
  assert.equal(JSON.parse(result.content[0].text).product_id, '294-101115');
  const bad = await client.callTool({ name: 'search_products', arguments: { query: 'x', limit: 51 } });
  assert.equal(bad.isError, true);
});

test('MCP upstream failures are explicit tool errors', async t => {
  const server = createServer(new SuperzooClient({ fetchImpl: async () => new Response('', { status: 503 }) }));
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  t.after(async () => { await client.close(); await server.close(); });
  const result = await client.callTool({ name: 'get_product_availability', arguments: { product_id: '294-101115' } });
  assert.equal(result.isError, true);
  assert.deepEqual(JSON.parse(result.content[0].text), { code: 'upstream_unavailable', message: 'Superzoo returned HTTP 503', retryable: true });
  assert.equal(result.structuredContent, undefined);
});

import { comparisonResultSchema, commonStoresResultSchema, searchResultSchema } from '../dist/contracts.js';

async function connect(t, api) {
  const server = createServer(api);
  const client = new Client({ name: 'protocol-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  t.after(async () => { await client.close(); await server.close(); });
  return client;
}

test('MCP handshake reports the package version', async t => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  const client = await connect(t, new SuperzooClient());
  assert.equal(client.getServerVersion().version, manifest.version);
});

test('aggregate tools preserve partial successes in declared output schemas', async t => {
  const stock = JSON.parse(readFileSync(new URL('./fixtures/store-availability.json', import.meta.url)));
  const api = new SuperzooClient({ fetchImpl: async url => {
    if (String(url).includes('/missing')) return new Response('', { status: 404 });
    return new Response(JSON.stringify(String(url).endsWith('/availability') ? stock : detail));
  } });
  const client = await connect(t, api);
  for (const [name, schema] of [['compare_products', comparisonResultSchema], ['find_common_stores', commonStoresResultSchema]]) {
    const result = await client.callTool({ name, arguments: { product_ids: ['294-101115', 'missing'] } });
    assert.equal(result.isError, undefined);
    const data = schema.parse(result.structuredContent);
    assert.equal(data.complete, false);
    assert.equal(data.products[1].error.code, 'not_found');
    assert.deepEqual(JSON.parse(result.content[0].text), data);
    if (name === 'find_common_stores') assert.ok(data.stores.every(store => !store.all_in_stock));
    const invalid = await client.callTool({ name, arguments: { product_ids: ['294-101115', '294-101115'] } });
    assert.equal(invalid.isError, true);
  }
});

test('MCP validates cross-field price ranges before invoking search and publishes bounded partial search results', async t => {
  let calls = 0;
  const search = JSON.parse(readFileSync(new URL('./fixtures/filtered-search.json', import.meta.url)));
  const client = await connect(t, new SuperzooClient({ fetchImpl: async url => {
    calls++;
    return String(url).includes('full-text-search') ? new Response(JSON.stringify(search)) : new Response('', { status: 404 });
  } }));
  const bad = await client.callTool({ name: 'search_products', arguments: { query: 'brit', min_price: '10', max_price: '9' } });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /Maximum price/);
  assert.equal(calls, 0);
  const result = await client.callTool({ name: 'search_products', arguments: { query: 'brit', limit: 1 } });
  const data = searchResultSchema.parse(result.structuredContent);
  assert.equal(data.coverage, 'bounded_candidates');
  assert.equal(data.detail_failures, 1);
  assert.equal(data.products[0].price, null);
});

test('MCP preserves stable error codes and hides unexpected exception details', async t => {
  const { SuperzooError } = await import('../dist/errors.js');
  let failure;
  const api = new SuperzooClient();
  api.getProduct = async () => { throw failure; };
  const client = await connect(t, api);
  for (const code of ['not_found', 'rate_limited', 'upstream_unavailable', 'invalid_response', 'timeout', 'cancelled', 'overloaded', 'internal_error']) {
    failure = new SuperzooError(code, 'Bounded message', true);
    const result = await client.callTool({ name: 'get_product', arguments: { product_id: '294-101115' } });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent, undefined);
    assert.deepEqual(JSON.parse(result.content[0].text), { code, message: 'Bounded message', retryable: true });
  }
  failure = new Error('private exception');
  const result = await client.callTool({ name: 'get_product', arguments: { product_id: '294-101115' } });
  assert.deepEqual(JSON.parse(result.content[0].text), { code: 'internal_error', message: 'Superzoo request failed', retryable: false });
});
