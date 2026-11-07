import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { SuperzooClient } from '../dist/client.js';

// Import must be inert; block fetch before loading the legacy CLI as well.
const originalFetch = globalThis.fetch;
let importFetches = 0;
globalThis.fetch = async () => { importFetches++; throw new Error('network forbidden in smoke tests'); };
let smoke;
let importError;
try { smoke = await import('../scripts/smoke.js'); } catch (error) { importError = error; smoke = {}; }
finally { globalThis.fetch = originalFetch; }

test('importing smoke does not start CLI requests', () => {
  assert.equal(importFetches, 0);
  assert.equal(importError, undefined);
});

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));
const detail = fixture('product-detail');
const stores = fixture('store-availability');
const item = { id: '294-101115', type: 'productCatalogue.product', title: 'Oil', alias: 'oil',
  attributes: { productSaleForbidden: ['false'], disallowedPriceLevels: [] } };
const response = data => new Response(JSON.stringify(data));

function fixtureClient(country = 'SK', override = () => undefined) {
  return new SuperzooClient({ country, fetchImpl: async url => {
    const custom = override(String(url));
    if (custom) return custom;
    if (new URL(url).hostname === 'full-text-search.superzoo.cz') {
      return response({ totalCount: 1, items: [item] });
    }
    return response(String(url).endsWith('/availability') ? stores : detail);
  } });
}

async function run(client, country = 'SK') {
  assert.equal(typeof smoke.runSmoke, 'function', 'testable smoke runner must be exported');
  const records = [];
  const ok = await smoke.runSmoke({ client, country, log: line => records.push(JSON.parse(line)) });
  return { ok, records };
}

test('smoke validates search, explicit detail, and stock for all markets without logging catalog data', async () => {
  for (const country of ['SK', 'CZ', 'PL']) {
    const { ok, records } = await run(fixtureClient(country), country);
    assert.equal(ok, true);
    assert.deepEqual(records.map(record => record.operation), ['search', 'product', 'availability']);
    for (const record of records) {
      assert.equal(record.market, country);
      assert.equal(record.result, 'ok');
      assert.ok(record.duration_ms >= 0 && Number.isFinite(record.duration_ms));
      assert.deepEqual(Object.keys(record).sort(), ['duration_ms', 'market', 'operation', 'result']);
    }
  }
});

test('smoke rejects malformed upstream responses with a bounded failure code', async () => {
  const { ok, records } = await run(fixtureClient('SK', () => response({})));
  assert.equal(ok, false);
  assert.deepEqual(records.map(record => record.code), ['invalid_response']);
});

test('smoke reports a transient failure only after the shared client exhausts retries', async () => {
  let attempts = 0;
  const { ok, records } = await run(fixtureClient('SK', () => {
    attempts++;
    return new Response('PRIVATE RESPONSE BODY', { status: 503, headers: { 'Retry-After': '0' } });
  }));
  assert.equal(attempts, 2);
  assert.equal(ok, false);
  assert.equal(records[0].code, 'upstream_unavailable');
  assert.ok(!JSON.stringify(records).includes('PRIVATE'));
});

test('smoke diagnoses empty search as a canary miss rather than an upstream outage', async () => {
  const { ok, records } = await run(fixtureClient('SK', () => response({ items: [], totalCount: 0 })));
  assert.equal(ok, false);
  assert.equal(records[0].code, 'empty_search');
});

async function resultsClient() {
  const client = fixtureClient();
  const search = await client.searchProducts({ query: 'brit care', limit: 1 });
  const product = await client.getProduct({ product_id: item.id });
  const stock = await client.getProductAvailability({ product_id: item.id });
  return { search, product, stock, client: {
    searchProducts: async () => search,
    getProduct: async () => product,
    getProductAvailability: async () => stock,
  } };
}

test('smoke rejects cross-market results and wrong currencies at every product boundary', async () => {
  for (const change of [
    data => { data.search.market = 'CZ'; },
    data => { data.search.products[0].price.currency = 'CZK'; },
    data => { data.product.market = 'CZ'; },
    data => { data.product.price.currency = 'PLN'; },
    data => { data.stock.market = 'CZ'; },
    data => { data.stock.product_id = 'different-id'; },
  ]) {
    const data = await resultsClient();
    change(data);
    const { ok, records } = await run(data.client);
    assert.equal(ok, false);
    assert.equal(records.at(-1).code, 'invalid_response');
  }
});

test('smoke accepts missing prices, changing pickup text and known unavailable/unknown stock', async () => {
  const data = await resultsClient();
  data.product.price = null;
  data.search.products[0].price = null;
  for (const status of ['inStock', 'available', 'notAvailable', 'unknown']) {
    for (const store of data.stock.stores) { store.status = status; store.pickup_text = null; }
    assert.equal((await run(data.client)).ok, true, `Observed status ${status} must be accepted without interpreting it`);
  }
});

test('smoke diagnoses no stores and unrecognized status codes without claiming stock', async () => {
  for (const change of [
    data => { data.stock.stores = []; data.stock.total_stores = 0; },
    data => { data.stock.stores[0].status = 'new-upstream-code'; },
    data => { data.product.checked_at = 'invalid timestamp'; },
  ]) {
    const data = await resultsClient();
    change(data);
    const { ok, records } = await run(data.client);
    assert.equal(ok, false);
    assert.ok(['empty_stock', 'invalid_response'].includes(records.at(-1).code));
  }
});

test('smoke never logs arbitrary failure messages or codes', async () => {
  const { ok, records } = await run({ searchProducts: async () => {
    throw Object.assign(new Error('PRIVATE QUERY AND ADDRESS'), { code: 'PRIVATE CODE' });
  } });
  assert.equal(ok, false);
  assert.equal(records[0].code, 'internal_error');
  assert.ok(!JSON.stringify(records).includes('PRIVATE'));
});


test('CLI exits zero for valid fixtures and nonzero for failed validation, with diagnostics only on stderr', () => {
  for (const malformed of [false, true]) {
    const setup = `globalThis.fetch = async url => new Response(JSON.stringify(${malformed ? '{}' :
      `String(url).includes('full-text-search') ? ${JSON.stringify({ totalCount: 1, items: [item] })} :
      String(url).endsWith('/availability') ? ${JSON.stringify(stores)} : ${JSON.stringify(detail)}`}));`;
    const child = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(setup)}`,
      new URL('../scripts/smoke.js', import.meta.url).pathname], {
      env: { ...process.env, SUPERZOO_COUNTRY: 'SK', SUPERZOO_TRANSPORT: 'stdio' }, encoding: 'utf8', timeout: 5000,
    });
    assert.equal(child.error, undefined);
    assert.equal(child.status, malformed ? 1 : 0, child.stderr);
    assert.equal(child.stdout, '');
    const records = child.stderr.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(records.at(-1).result, malformed ? 'failed' : 'ok');
    assert.ok(!child.stderr.includes('BRIT Care'));
    assert.ok(!child.stderr.includes('Bratislava'));
  }
});
