import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as turn } from 'node:timers/promises';
import { z } from 'zod';
import { createRequestPolicy } from '../dist/request.js';

const schema = z.object({ value: z.string() });
const response = (value = 'ok') => new Response(JSON.stringify({ value }));
const args = (productId = 'one', extra = {}) => ({ market: 'SK', operation: 'product', productId,
  url: `https://www.superzoo.sk/web-api/products/${productId}`, schema, ...extra });
const code = expected => error => error.code === expected;
const clock = t => t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.parse('2026-11-06T10:00:00Z') });
const tick = async (t, ms) => { t.mock.timers.tick(ms); await turn(); };
function heldFetch() {
  const pending = [];
  let active = 0;
  let peak = 0;
  const fetchImpl = (url, { signal }) => new Promise((resolve, reject) => {
    active++;
    peak = Math.max(active, peak);
    let done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      active--;
      signal.removeEventListener('abort', abort);
      error ? reject(error) : resolve(value);
    };
    const abort = () => finish(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    pending.push({ url: String(url), signal, resolve: (value = response()) => finish(null, value) });
  });
  return { fetchImpl, pending, get active() { return active; }, get peak() { return peak; } };
}

test('policy caps active upstream work at four and rejects only beyond 128 queued operations', async () => {
  const held = heldFetch();
  const policy = createRequestPolicy({ fetchImpl: held.fetchImpl });
  const requests = Array.from({ length: 132 }, (_, i) => policy.request(args(`id-${i}`)));
  await turn();
  assert.equal(held.active, 4);
  await assert.rejects(policy.request(args('overflow')), code('overloaded'));
  for (let index = 0; index < 132; index++) {
    held.pending[index].resolve();
    await turn();
  }
  const results = await Promise.all(requests);
  assert.equal(results.length, 132);
  assert.equal(held.peak, 4);
});

test('cancelled queued work never fetches and frees its queue slot', async () => {
  const held = heldFetch();
  const policy = createRequestPolicy({ fetchImpl: held.fetchImpl });
  const active = Array.from({ length: 4 }, (_, i) => policy.request(args(`active-${i}`)));
  const controller = new AbortController();
  const queued = policy.request(args('cancel-queued', { signal: controller.signal }));
  const rejected = assert.rejects(queued, code('cancelled'));
  controller.abort(new Error('private caller abort reason'));
  await rejected;
  const next = policy.request(args('next'));
  held.pending[0].resolve();
  await turn();
  assert.equal(held.pending.length, 5);
  assert.match(held.pending[4].url, /next$/);
  held.pending.forEach(request => request.resolve());
  await Promise.all([...active, next]);
});

test('deadline covers queue time instead of restarting when a slot opens', async t => {
  clock(t);
  const held = heldFetch();
  const policy = createRequestPolicy({ fetchImpl: held.fetchImpl, timeoutMs: 100 });
  const active = Array.from({ length: 4 }, (_, i) => policy.request(args(`active-${i}`)));
  const activeRejected = Promise.all(active.map(promise => assert.rejects(promise, code('timeout'))));
  await tick(t, 20);
  const queued = policy.request(args('queued'));
  const rejected = assert.rejects(queued, code('timeout'));
  await tick(t, 80);
  assert.equal(held.pending.length, 5);
  await tick(t, 20);
  await Promise.all([activeRejected, rejected]);
  assert.equal(held.pending[4].signal.aborted, true);
});

test('a queued deadline removes work even before active requests settle', async t => {
  clock(t);
  const held = heldFetch();
  const policy = createRequestPolicy({ fetchImpl: held.fetchImpl, timeoutMs: 100 });
  const controller = new AbortController();
  const active = Array.from({ length: 4 }, (_, i) => policy.request(args(`active-${i}`)));
  const rejectedActive = Promise.all(active.map(promise => assert.rejects(promise, code('timeout'))));
  const queued = policy.request(args('queued', { signal: controller.signal }));
  const rejected = assert.rejects(queued, code('timeout'));
  await tick(t, 100);
  await Promise.all([rejectedActive, rejected]);
  assert.equal(held.pending.some(item => item.url.endsWith('/queued')), false);
});

test('product and availability TTLs retain retrieval timestamps and never serve expired entries after errors', async t => {
  clock(t);
  let count = 0;
  let fail = false;
  const policy = createRequestPolicy({ fetchImpl: async () => { count++; return fail ? new Response('', { status: 404 }) : response(String(count)); } });
  const product = await policy.request(args());
  const availability = await policy.request(args('one', { operation: 'availability' }));
  await tick(t, 14_999);
  assert.deepEqual(await policy.request(args()), product);
  assert.deepEqual(await policy.request(args('one', { operation: 'availability' })), availability);
  await tick(t, 1);
  assert.equal((await policy.request(args('one', { operation: 'availability' }))).data.value, '3');
  await tick(t, 44_999);
  assert.deepEqual(await policy.request(args()), product);
  await tick(t, 1);
  fail = true;
  await assert.rejects(policy.request(args()), code('not_found'));
  fail = false;
  const fresh = await policy.request(args());
  assert.equal(fresh.data.value, '5');
  assert.notEqual(fresh.checked_at, product.checked_at);
});

test('one cache holds at most 256 entries across operations; hits refresh eviction order', async () => {
  let count = 0;
  const policy = createRequestPolicy({ fetchImpl: async () => response(String(++count)) });
  const first = await policy.request(args('id-0'));
  for (let i = 1; i < 256; i++) await policy.request(args(`id-${i}`, { operation: i % 2 ? 'availability' : 'product' }));
  assert.deepEqual(await policy.request(args('id-0')), first);
  await policy.request(args('new'));
  assert.deepEqual(await policy.request(args('id-0')), first);
  assert.equal((await policy.request(args('id-1', { operation: 'availability' }))).data.value, '258');
});

test('cache keys separate markets, operations, and IDs; search never caches', async () => {
  let count = 0;
  const policy = createRequestPolicy({ fetchImpl: async () => response(String(++count)) });
  assert.equal((await policy.request(args())).data.value, '1');
  assert.equal((await policy.request(args('one', { market: 'CZ' }))).data.value, '2');
  assert.equal((await policy.request(args('one', { operation: 'availability' }))).data.value, '3');
  assert.equal((await policy.request(args('two'))).data.value, '4');
  assert.equal((await policy.request(args('one', { operation: 'search' }))).data.value, '5');
  assert.equal((await policy.request(args('one', { operation: 'search' }))).data.value, '6');
  assert.equal((await policy.request(args())).data.value, '1');
});

test('duplicate callers share fetch and original timestamp, but cancellation affects only one waiter', async () => {
  const held = heldFetch();
  const policy = createRequestPolicy({ fetchImpl: held.fetchImpl });
  const controller = new AbortController();
  const cancelled = policy.request(args('one', { signal: controller.signal }));
  const survivor = policy.request(args());
  const rejected = assert.rejects(cancelled, code('cancelled'));
  controller.abort();
  await rejected;
  assert.equal(held.pending.length, 1);
  assert.equal(held.pending[0].signal.aborted, false);
  held.pending[0].resolve();
  const result = await survivor;
  assert.deepEqual(await policy.request(args()), result);
});

test('last cancelled waiter aborts upstream; immediate replacement does not join doomed work', async () => {
  const held = heldFetch();
  const policy = createRequestPolicy({ fetchImpl: held.fetchImpl });
  const controllers = [new AbortController(), new AbortController()];
  const pending = controllers.map(controller => policy.request(args('one', { signal: controller.signal })));
  const rejected = Promise.all(pending.map(promise => assert.rejects(promise, code('cancelled'))));
  await turn();
  controllers.forEach(controller => controller.abort());
  const replacement = policy.request(args());
  await turn();
  await rejected;
  assert.equal(held.pending[0].signal.aborted, true);
  assert.equal(held.pending.length, 2);
  held.pending[1].resolve();
  await replacement;
});

test('failed and completed flights are removed, and result mutation cannot corrupt shared cache', async () => {
  let count = 0;
  const policy = createRequestPolicy({ fetchImpl: async () => ++count === 1 ? new Response('', { status: 404 }) : response('fresh') });
  await assert.rejects(policy.request(args()), code('not_found'));
  const first = await policy.request(args());
  first.data.value = 'mutated';
  assert.equal((await policy.request(args())).data.value, 'fresh');
  assert.equal(count, 2);
});

test('retryable HTTP statuses and network failures get at most two attempts with bounded jitter', async t => {
  clock(t);
  for (const status of [429, 502, 503, 504, 'network']) {
    let count = 0;
    const policy = createRequestPolicy({ fetchImpl: async () => {
      count++;
      if (count > 1) return response();
      if (status === 'network') throw new TypeError('private network detail');
      return new Response('', { status });
    } });
    const pending = policy.request(args());
    await turn();
    await tick(t, 199);
    assert.equal(count, 1);
    await tick(t, 301);
    assert.equal((await pending).data.value, 'ok');
    assert.equal(count, 2);
  }
  let count = 0;
  const policy = createRequestPolicy({ fetchImpl: async () => { count++; return new Response('', { status: 503 }); } });
  const pending = policy.request(args());
  const rejected = assert.rejects(pending, code('upstream_unavailable'));
  await turn();
  await tick(t, 500);
  await rejected;
  assert.equal(count, 2);
});

test('Retry-After seconds and HTTP dates are honored; delays beyond the deadline are not retried', async t => {
  clock(t);
  for (const makeRetryAfter of [() => '2', () => new Date(Date.now() + 2000).toUTCString()]) {
    const retryAfter = makeRetryAfter();
    let count = 0;
    const policy = createRequestPolicy({ fetchImpl: async () => ++count === 1
      ? new Response('', { status: 429, headers: { 'Retry-After': retryAfter } }) : response() });
    const pending = policy.request(args());
    await turn();
    await tick(t, 1999);
    assert.equal(count, 1);
    await tick(t, 1);
    await pending;
    assert.equal(count, 2);
  }
  let count = 0;
  const policy = createRequestPolicy({ timeoutMs: 100, fetchImpl: async () => { count++;
    return new Response('', { status: 503, headers: { 'Retry-After': '10' } });
  } });
  await assert.rejects(policy.request(args()), code('upstream_unavailable'));
  assert.equal(count, 1);
});

test('deadline and caller cancellation cover retry backoff', async t => {
  clock(t);
  let count = 0;
  const policy = createRequestPolicy({ timeoutMs: 1000, fetchImpl: async () => { count++;
    return new Response('', { status: 503, headers: { 'Retry-After': '0' } });
  } });
  // The retry starts immediately, but must not receive a fresh timeout budget.
  const held = heldFetch();
  let attempts = 0;
  const deadlinePolicy = createRequestPolicy({ timeoutMs: 1000, fetchImpl: async (...fetchArgs) => {
    if (++attempts === 1) return new Response('', { status: 503, headers: { 'Retry-After': '1' } });
    return held.fetchImpl(...fetchArgs);
  } });
  await assert.rejects(deadlinePolicy.request(args()), code('upstream_unavailable'));
  assert.equal(attempts, 1);
  const controller = new AbortController();
  const cancelPolicy = createRequestPolicy({ fetchImpl: async () => { count++;
    return new Response('', { status: 503, headers: { 'Retry-After': '2' } });
  } });
  const pending = cancelPolicy.request(args('one', { signal: controller.signal }));
  const rejected = assert.rejects(pending, code('cancelled'));
  await turn();
  controller.abort();
  await rejected;
  await tick(t, 2000);
  assert.equal(count, 1);
  // Exercise zero-delay Retry-After separately.
  const zero = policy.request(args());
  const zeroRejected = assert.rejects(zero, code('upstream_unavailable'));
  await turn();
  await tick(t, 0);
  await zeroRejected;
  assert.equal(count, 3);
});

test('JSON/schema errors and non-retryable HTTP responses are not cached or retried', async () => {
  for (const [make, expected] of [
    [() => new Response('bad json'), 'invalid_response'],
    [() => new Response('{}'), 'invalid_response'],
    [() => new Response('', { status: 404 }), 'not_found'],
    [() => new Response('', { status: 400 }), 'upstream_unavailable'],
  ]) {
    let count = 0;
    const policy = createRequestPolicy({ fetchImpl: async () => { count++; return make(); } });
    await assert.rejects(policy.request(args()), error => error.code === expected && error.retryable === false);
    await assert.rejects(policy.request(args()), code(expected));
    assert.equal(count, 2);
  }
});

test('abort before cache hit or before enqueue remains cancellation', async () => {
  let count = 0;
  const policy = createRequestPolicy({ fetchImpl: async () => { count++; return response(); } });
  await policy.request(args());
  const signal = AbortSignal.abort();
  await assert.rejects(policy.request(args('one', { signal })), code('cancelled'));
  await assert.rejects(policy.request(args('new', { signal })), code('cancelled'));
  assert.equal(count, 1);
});

test('request deadline covers a stalled response body even if injected fetch ignores abort', async t => {
  clock(t);
  const policy = createRequestPolicy({ timeoutMs: 100, fetchImpl: async () => ({
    ok: true, json: () => new Promise(() => {}),
  }) });
  const pending = policy.request(args());
  const rejected = assert.rejects(pending, code('timeout'));
  await turn();
  await tick(t, 100);
  await rejected;
});

test('diagnostics contain only bounded metadata, including cache hits and failures', async t => {
  const lines = [];
  t.mock.method(console, 'error', line => lines.push(JSON.parse(line)));
  const policy = createRequestPolicy({ fetchImpl: async () => response() });
  await policy.request(args('sensitive-product', { url: 'https://www.superzoo.sk/?query=secret', init: { headers: { Authorization: 'secret' } } }));
  await policy.request(args('sensitive-product'));
  const badPolicy = createRequestPolicy({ fetchImpl: async () => new Response('{}') });
  await assert.rejects(badPolicy.request(args()), code('invalid_response'));
  assert.equal(lines.length, 3);
  assert.deepEqual(lines.map(line => line.cache_hit), [false, true, false]);
  assert.equal(lines[2].status, 'invalid_response');
  for (const line of lines) {
    assert.deepEqual(Object.keys(line).sort(), ['cache_hit', 'duration_ms', 'market', 'operation', 'status']);
    assert.ok(Number.isFinite(line.duration_ms) && line.duration_ms >= 0);
  }
  assert.doesNotMatch(JSON.stringify(lines), /secret|sensitive-product|Authorization/);
});

test('retry attempt only has the time remaining from the original deadline', async t => {
  clock(t);
  const held = heldFetch();
  let count = 0;
  const policy = createRequestPolicy({ timeoutMs: 1500, fetchImpl: async (...fetchArgs) => {
    if (++count === 1) return new Response('', { status: 503, headers: { 'Retry-After': '1' } });
    return held.fetchImpl(...fetchArgs);
  } });
  const pending = policy.request(args());
  const rejected = assert.rejects(pending, code('timeout'));
  await turn();
  await tick(t, 1000);
  assert.equal(count, 2);
  await tick(t, 499);
  assert.equal(held.pending[0].signal.aborted, false);
  await tick(t, 1);
  await rejected;
  assert.equal(held.pending[0].signal.aborted, true);
});

test('each request enforces redirect rejection and JSON accept while preserving POST headers/body', async () => {
  const policy = createRequestPolicy({ fetchImpl: async (_, options) => {
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.get('Accept'), 'application/json');
    assert.equal(options.headers.get('Content-Type'), 'application/json');
    assert.equal(options.method, 'POST');
    assert.equal(options.body, '{}');
    assert.ok(options.signal instanceof AbortSignal);
    return response();
  } });
  await policy.request(args('one', { operation: 'availability', init: {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', redirect: 'follow',
  } }));
});

test('network failures while reading response bodies share the same retry budget', async t => {
  clock(t);
  let count = 0;
  const policy = createRequestPolicy({ fetchImpl: async () => {
    if (++count > 1) return response('retried body');
    return new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('terminated: private socket detail')); } }));
  } });
  const pending = policy.request(args());
  // Attach immediately so the pre-fix rejection is observed by the test runner.
  const observed = pending.then(result => ({ result }), error => ({ error }));
  await turn();
  await tick(t, 500);
  const outcome = await observed;
  assert.equal(outcome.error, undefined);
  assert.equal(outcome.result.data.value, 'retried body');
  assert.equal(count, 2);
});
