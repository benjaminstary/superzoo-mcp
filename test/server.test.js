import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../dist/server.js';
import { SuperzooClient } from '../dist/client.js';
import { readFileSync } from 'node:fs';

const detail = JSON.parse(readFileSync(new URL('./fixtures/product-detail.json', import.meta.url)));

test('MCP exposes three read-only tools, validates input and returns structured price data', async t => {
  const server = createServer(new SuperzooClient({ fetchImpl: async () => new Response(JSON.stringify(detail)) }));
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  t.after(async () => { await client.close(); await server.close(); });
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name).sort(), ['get_product', 'get_product_availability', 'search_products']);
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
  assert.match(result.content[0].text, /503/);
});
