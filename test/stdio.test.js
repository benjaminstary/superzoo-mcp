import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';

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
  assert.equal((await client.listTools()).tools.length, 9);
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
  assert.equal((await client.listTools()).tools.length, 9);
});

for (const requestId of [0, '']) {
  test(`stdio cancels request ID ${JSON.stringify(requestId)}`, { timeout: 5000 }, async t => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      env: { ...process.env, SUPERZOO_COUNTRY: 'SK', SUPERZOO_TRANSPORT: 'stdio' },
      args: ['--import', fileURLToPath(new URL('./helpers/fixture-fetch.js', import.meta.url)),
        fileURLToPath(new URL('../dist/index.js', import.meta.url))], stderr: 'pipe',
    });
    let stderr = '';
    transport.stderr.on('data', data => { stderr += data; });
    const responses = new Map();
    transport.onmessage = message => responses.set(message.id, message);
    t.after(() => transport.close());
    await transport.start();

    const send = message => transport.send({ jsonrpc: '2.0', ...message });
    const initializeId = requestId === 0 ? '' : 0;
    await send({ id: initializeId, method: 'initialize', params: {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'stdio-raw-test', version: '1' },
    } });
    await waitFor(() => responses.has(initializeId));
    assert.equal(responses.get(initializeId).result.serverInfo.name, 'superzoo-mcp');
    await send({ method: 'notifications/initialized' });
    await send({ id: requestId, method: 'tools/call', params: {
      name: 'get_product', arguments: { product_id: 'cancel-test' },
    } });
    await waitFor(() => stderr.includes('fixture-started'));

    // String "0" must keep its own ID while a numeric-zero request is active.
    await send({ id: '0', method: 'tools/list' });
    await waitFor(() => responses.has('0'));
    assert.equal(responses.get('0').result.tools.length, 9);

    await send({ method: 'notifications/cancelled', params: { requestId } });
    await waitFor(() => stderr.includes('fixture-aborted'), 'upstream abort');
    await waitFor(() => stderr.includes('"status":"cancelled"'));

    await send({ id: 1, method: 'tools/list' });
    await waitFor(() => responses.has(1));
    assert.equal(responses.get(1).result.tools.length, 9);
    assert.equal(responses.has(requestId), false);
  });
}

async function waitFor(predicate, event = 'stdio event') {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, `Timed out waiting for ${event}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
