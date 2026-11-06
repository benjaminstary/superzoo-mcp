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
  assert.equal((await client.listTools()).tools.length, 3);
  const result = await client.callTool({ name: 'get_product', arguments: { product_id: '294-101115' } });
  assert.equal(result.structuredContent.price.amount, '13.99');
  assert.equal(stderr, '');
});
