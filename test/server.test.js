import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../dist/server.js';
import { SuperzooClient } from '../dist/client.js';
import { readFileSync } from 'node:fs';

const detail = JSON.parse(readFileSync(new URL('./fixtures/product-detail.json', import.meta.url)));

test('MCP exposes seven read-only tools in Slovakia, validates input and returns structured price data', async t => {
  const server = createServer(new SuperzooClient({ fetchImpl: async () => new Response(JSON.stringify(detail)) }));
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  t.after(async () => { await client.close(); await server.close(); });
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name).sort(), ['compare_products', 'find_common_stores', 'find_stores', 'get_delivery_options', 'get_product', 'get_product_availability', 'search_products']);
  assert.ok(tools.every(tool => tool.outputSchema?.type === 'object'));
  assert.ok(tools.find(tool => tool.name === 'search_products').inputSchema.properties.online_only);
  assert.equal(tools.find(tool => tool.name === 'get_delivery_options').inputSchema.properties.quantity.maximum, 2);
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

test('MCP advertises the Czech locator and validates coordinates before the request', async t => {
  const calls = [];
  const client = await connect(t, new SuperzooClient({ country: 'CZ', fetchImpl: async (url, options) => {
    calls.push([String(url), JSON.parse(options.body)]);
    return new Response(JSON.stringify({ nearestStore: {
      id: 'CZPIC-330', name: 'Praha Podbaba', address: 'Pod Paťankou 2750/1c, Praha 6',
      latitude: 50.1125306, longitude: 14.3928678,
    } }));
  } }));
  const { tools } = await client.listTools();
  const locator = tools.find(tool => tool.name === 'find_stores');
  assert.ok(locator);
  assert.deepEqual(locator.inputSchema.required.sort(), ['latitude', 'longitude']);
  const valid = { latitude: 50.08, longitude: 14.43 };
  for (const args of [{ latitude: 50 }, { ...valid, longitude: 181 }, { ...valid, limit: 2 }]) {
    const bad = await client.callTool({ name: 'find_stores', arguments: args });
    assert.equal(bad.isError, true);
    assert.match(bad.content[0].text, /Input validation error/);
  }
  assert.deepEqual(calls, []);
  const result = await client.callTool({ name: 'find_stores', arguments: valid });
  const source = 'https://www.superzoo.cz/web-api/stores/nearest-store';
  assert.deepEqual(calls, [[source, valid]]);
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.source, source);
  assert.equal(result.structuredContent.market, 'CZ');
  assert.equal(result.structuredContent.coverage, 'nearest_store');
  assert.equal(result.structuredContent.stores[0].store_id, 'CZPIC-330');
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
});

test('MCP advertises optional quantity for Czech delivery quotes and returns it in structured results', async t => {
  const calls = [];
  const product = { productId: '294-101115', quantity: 2 };
  const client = await connect(t, new SuperzooClient({ country: 'CZ', fetchImpl: async (url, options) => {
    const request = JSON.parse(options.body);
    calls.push(request);
    return new Response(JSON.stringify({ shippingOptions: {
      shipment: { items: [request.product] }, items: [request.product], personalPickups: [],
      deliveryMethods: [{ deliveryMethodId: '23b3f7f3-17d6-4694-a5eb-9822de093d65', name: 'Zásilkovna domů',
        price: { amountIncVat: '99', currency: 'CZK' }, deliveryDate: '2026-11-24T16:00:00+01:00' }],
    } }));
  } }));
  const { tools } = await client.listTools();
  const tool = tools.find(tool => tool.name === 'get_delivery_options');
  assert.ok(tool);
  assert.deepEqual(tool.inputSchema.required, ['product_id']);
  assert.equal(tool.inputSchema.properties.quantity.type, 'integer');
  assert.equal(tool.inputSchema.properties.quantity.minimum, 1);
  assert.equal(tool.inputSchema.properties.quantity.maximum, 2);
  assert.equal(tool.inputSchema.properties.quantity.default, 1);
  assert.equal(tool.outputSchema.type, 'object');
  const args = { product_id: product.productId };
  for (const invalid of [{ postal_code: '16000' }, { quantity: 3 }]) {
    const bad = await client.callTool({ name: tool.name, arguments: { ...args, ...invalid } });
    assert.equal(bad.isError, true);
  }
  assert.deepEqual(calls, []);
  const result = await client.callTool({ name: tool.name, arguments: { ...args, quantity: 2 } });
  assert.equal(result.isError, undefined);
  assert.deepEqual(calls, [{ webId: 'superzoo_cz', product }]);
  assert.equal(result.structuredContent.market, 'CZ');
  assert.equal(result.structuredContent.quantity, 2);
  assert.deepEqual(result.structuredContent.delivery_methods[0].price, { amount: '99', currency: 'CZK' });
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  const defaultQuote = await client.callTool({ name: tool.name, arguments: args });
  assert.equal(defaultQuote.isError, undefined);
  assert.deepEqual(calls[1], { webId: 'superzoo_cz', product: { ...product, quantity: 1 } });
  assert.equal(defaultQuote.structuredContent.quantity, 1);
});

test('MCP leaves unverified Polish locator and delivery quotes out of discovery', async t => {
  const client = await connect(t, new SuperzooClient({ country: 'PL' }));
  const { tools } = await client.listTools();
  assert.equal(tools.length, 5);
  assert.ok(!tools.some(tool => tool.name === 'find_stores'));
  assert.ok(!tools.some(tool => tool.name === 'get_delivery_options'));
});

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
