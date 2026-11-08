import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer as createNetServer } from 'node:net';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';

const executable = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const preload = fileURLToPath(new URL('./helpers/shutdown-fetch.js', import.meta.url));
const call = (id, productId) => ({ jsonrpc: '2.0', id, method: 'tools/call',
  params: { name: 'get_product', arguments: { product_id: productId } } });

async function waitFor(predicate) {
  const deadline = Date.now() + 2500;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'Timed out waiting for child event');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

async function start(t, transport) {
  const listener = createNetServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const child = spawn(process.execPath, ['--import', preload, executable], {
    env: { ...process.env, SUPERZOO_COUNTRY: 'SK', SUPERZOO_TRANSPORT: transport,
      SUPERZOO_HOST: '127.0.0.1', SUPERZOO_PORT: String(port) },
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  });
  const messages = [];
  let stderr = '';
  let stdout = '';
  child.on('message', data => messages.push(data));
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.on('data', chunk => { stdout += chunk; });
  // close follows exit and draining of stdio, including final cancellation diagnostics.
  const exited = once(child, 'close');
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  if (transport === 'http') await waitFor(() => stderr.includes('listening at'));
  else {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 'ready', method: 'tools/list' }) + '\n');
    await waitFor(() => stdout.includes('"id":"ready"'));
  }
  return { child, messages, exited, url: `http://127.0.0.1:${port}/mcp`,
    stderr: () => stderr, stdout: () => stdout };
}

function httpCall(url, body) {
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
  result.catch(() => {});
  req.end(JSON.stringify(body));
  return result;
}

for (const transport of ['stdio', 'http']) {
  test(`${transport} SIGTERM cancels active and queued work and exits cleanly`, { timeout: 9000 }, async t => {
    const app = await start(t, transport);
    const count = 6;
    for (let id = 0; id < count; id++) {
      const body = call(id, `shutdown-${id}`);
      if (transport === 'http') httpCall(app.url, body);
      else app.child.stdin.write(JSON.stringify(body) + '\n');
    }
    await waitFor(() => app.messages.filter(x => x.event === 'fetch_started').length === 4);
    // A protocol round trip lets already-sent tool requests enter the shared queue.
    if (transport === 'http') {
      const response = await fetch(new URL('/health', app.url));
      assert.equal(response.status, 200);
      await response.arrayBuffer();
    } else {
      app.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 'barrier', method: 'tools/list' }) + '\n');
      await waitFor(() => app.stdout().includes('"id":"barrier"'));
    }
    app.child.kill('SIGTERM');
    const [code, signal] = await app.exited;
    assert.equal(code, 0, app.stderr());
    assert.equal(signal, null);
    assert.equal(app.messages.filter(x => x.event === 'fetch_started').length, 4, 'queued requests must never fetch');
    assert.equal(app.messages.filter(x => x.event === 'fetch_aborted').length, 4);
    const records = app.stderr().split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
    assert.equal(records.filter(x => x.status === 'cancelled').length, count);
  });
}

test('HTTP SIGTERM drains a completing response and stops accepting connections', { timeout: 7000 }, async t => {
  const app = await start(t, 'http');
  const result = httpCall(app.url, call(1, 'shutdown-fast'));
  await waitFor(() => app.messages.some(x => x.event === 'fetch_started'));
  app.child.kill('SIGTERM');
  const response = await result;
  assert.equal(response.result.structuredContent.product_id, 'shutdown-fast');
  assert.equal(response.result.isError, undefined);
  await assert.rejects(fetch(new URL('/health', app.url)));
  const [code, signal] = await app.exited;
  assert.equal(code, 0, app.stderr());
  assert.equal(signal, null);
  assert.equal(app.messages.some(x => x.event === 'fetch_aborted'), false);
});
