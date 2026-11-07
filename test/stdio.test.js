import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('executable serves MCP handshake, tool listing and product lookup over clean stdio', async t => {
  const client = new Client({ name: 'stdio-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    env: { ...process.env, SUPERZOO_COUNTRY: 'SK', SUPERZOO_TRANSPORT: 'stdio' },
    args: ['--import', fileURLToPath(new URL('./helpers/fixture-fetch.js', import.meta.url)),
      fileURLToPath(new URL('../dist/index.js', import.meta.url))],
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr.on('data', data => { stderr += data; });
  t.after(() => client.close());
  await client.connect(transport);
  assert.equal((await client.listTools()).tools.length, 5);
  const result = await client.callTool({ name: 'get_product', arguments: { product_id: '294-101115' } });
  assert.equal(result.structuredContent.price.amount, '13.99');
  await client.close();
  const diagnostics = stderr.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(diagnostics.length, 1);
  const [diagnostic] = diagnostics;
  assert.deepEqual(Object.keys(diagnostic).sort(), ['cache_hit', 'duration_ms', 'market', 'operation', 'status']);
  assert.equal(diagnostic.market, 'SK');
  assert.equal(diagnostic.operation, 'product');
  assert.equal(diagnostic.status, 'ok');
  assert.equal(diagnostic.cache_hit, false);
  assert.ok(Number.isFinite(diagnostic.duration_ms) && diagnostic.duration_ms >= 0);
});

test('stdio protocol cancellation reaches upstream work and leaves the connection usable', { timeout: 5000 }, async t => {
  const client = new Client({ name: 'stdio-cancel-test', version: '1' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    env: { ...process.env, SUPERZOO_COUNTRY: 'SK', SUPERZOO_TRANSPORT: 'stdio' },
    args: ['--import', fileURLToPath(new URL('./helpers/fixture-fetch.js', import.meta.url)),
      fileURLToPath(new URL('../dist/index.js', import.meta.url))], stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr.on('data', data => { stderr += data; });
  t.after(() => client.close());
  await client.connect(transport);
  const controller = new AbortController();
  const pending = client.callTool({ name: 'get_product', arguments: { product_id: 'cancel-test' } }, undefined, { signal: controller.signal });
  const rejected = assert.rejects(pending);
  await waitFor(() => stderr.includes('fixture-started'));
  controller.abort();
  await rejected;
  await waitFor(() => stderr.includes('"status":"cancelled"'));
  assert.ok(stderr.includes('fixture-aborted'));
  assert.equal((await client.listTools()).tools.length, 5);
});

async function waitFor(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'Timed out waiting for stdio event');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
