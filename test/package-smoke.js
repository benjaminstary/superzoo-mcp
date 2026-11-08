// Separate gate: installing the consumer tarball may access the npm registry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));

test('packed npm package installs and serves MCP through its consumer executable', { timeout: 120000 }, async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'superzoo-package-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const consumer = join(temporary, 'consumer');
  await mkdir(consumer);
  const env = { ...process.env, npm_config_cache: join(temporary, 'npm-cache') };
  const packed = await exec('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], {
    cwd: root, env, timeout: 30000,
  });
  const [{ filename }] = JSON.parse(packed.stdout);
  await exec('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false',
    '--prefix', consumer, join(temporary, filename)], { cwd: consumer, env, timeout: 90000 });
  const installed = join(consumer, 'node_modules', 'superzoo-mcp');
  const manifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
  assert.equal(manifest.bin['superzoo-mcp'], 'dist/index.js');
  const client = new Client({ name: 'installed-package-test', version: '1' });
  const transport = new StdioClientTransport({
    command: join(consumer, 'node_modules', '.bin', 'superzoo-mcp'),
    cwd: consumer,
    env: { ...process.env, SUPERZOO_COUNTRY: 'SK', SUPERZOO_TRANSPORT: 'stdio',
      NODE_OPTIONS: `--import=${new URL('./helpers/fixture-fetch.js', import.meta.url).href}` },
    stderr: 'pipe',
  });
  let diagnostics = '';
  transport.stderr.on('data', chunk => { diagnostics += chunk; });
  t.after(() => client.close());
  await client.connect(transport);
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map(tool => tool.name).sort(),
    ['compare_products', 'find_common_stores', 'get_product', 'get_product_availability', 'search_products']);
  assert.ok(tools.tools.every(tool => tool.outputSchema?.type === 'object'));
  const product = await client.callTool({ name: 'get_product', arguments: { product_id: '294-101115' } });
  assert.equal(product.isError, undefined, diagnostics);
  assert.equal(product.structuredContent.price.amount, '13.99');
  assert.equal(product.structuredContent.market, 'SK');
  await client.close();
});
