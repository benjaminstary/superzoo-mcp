import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SuperzooClient } from '../dist/client.js';
import { getMarket } from '../dist/config.js';
import { SuperzooError } from '../dist/errors.js';
import { comparisonResultSchema, commonStoresResultSchema } from '../dist/contracts.js';
import * as shopping from '../dist/shopping.js';

const { compareProducts, findCommonStores } = shopping;
const market = getMarket('SK');
const oldTime = '2026-11-01T10:00:00.000Z';
const newerTime = '2026-11-01T11:00:00.000Z';
const ids = Array.from({ length: 10 }, (_, i) => `item-${i}`);
const product = product_id => ({
  source: `${market.web}/web-api/products/${product_id}`, market: 'SK', checked_at: oldTime,
  product_id, name: 'Food', url: `${market.web}/food/`, ean: null, catalogue_number: null,
  brand: null, can_buy: null, price: {
    amount: '13.99', currency: 'EUR', context: 'public_online', variant: 'family',
    original_amount: '15.99', lowest_amount: null, sale_percentage: null, voucher_campaign: null,
  }, variants: [], availability: null,
});
const store = (store_id, status = 'inStock', name = `Store ${store_id}`) => ({
  store_id, name, address: 'Žilina', url: `${market.web}/store-${store_id}/`,
  opening_hours_html: null, status, pickup_text: 'zajtra od 11:00', quantity: null,
});
const availability = (product_id, stores = [], checked_at = oldTime) => ({
  source: `${market.web}/web-api/products/${product_id}/availability`, market: 'SK', checked_at,
  product_id, city_filter: null, total_stores: stores.length, stores,
});
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const methods = [
  ['comparison', compareProducts, 'getProduct', product],
  ['common stores', findCommonStores, 'getProductAvailability', id => availability(id, [store('a')])],
];

for (const [name, run, method, resultFor] of methods) {
  for (const count of [1, 10]) {
    test(`${name} accepts ${count} IDs and conforms to its output contract`, async () => {
      const selected = ids.slice(0, count);
      const result = await run({ market, [method]: async ({ product_id }) => resultFor(product_id) }, { product_ids: selected });
      assert.deepEqual(result.product_ids, selected);
      assert.deepEqual(result.products.map(p => p.product_id), selected);
      assert.equal(result.complete, true);
      assert.equal(result.market, 'SK');
      assert.ok(Date.parse(result.checked_at) >= Date.parse(oldTime));
      const schema = name === 'comparison' ? comparisonResultSchema : commonStoresResultSchema;
      assert.deepEqual(schema.parse(result), result);
    });
  }

  test(`${name} rejects invalid batches before any lookup`, async () => {
    let calls = 0;
    const client = { market, [method]: async () => { calls++; } };
    for (const product_ids of [[], [...ids, 'item-10'], ['same', 'same'], ['../bad'], ['']]) {
      await assert.rejects(run(client, { product_ids }));
    }
    assert.equal(calls, 0);
  });

  test(`${name} bounds lookups at four and retains input order despite completion order`, async () => {
    const firstWave = ids.slice(0, 4).map(() => deferred());
    const started = deferred();
    let calls = 0;
    let active = 0;
    let peak = 0;
    const client = { market, [method]: async ({ product_id }) => {
      const index = calls++;
      active++;
      peak = Math.max(peak, active);
      if (calls === 4) started.resolve();
      if (index < 4) await firstWave[index].promise;
      active--;
      return resultFor(product_id);
    } };
    const pending = run(client, { product_ids: ids });
    await started.promise;
    assert.equal(calls, 4);
    firstWave[3].resolve();
    firstWave[2].resolve();
    firstWave[1].resolve();
    firstWave[0].resolve();
    const result = await pending;
    assert.equal(peak, 4);
    assert.equal(calls, 10);
    assert.deepEqual(result.products.map(p => p.product_id), ids);
  });

  test(`${name} rejects an already aborted context without starting work`, async () => {
    let calls = 0;
    const context = { signal: AbortSignal.abort() };
    await assert.rejects(run({ market, [method]: async () => { calls++; } }, { product_ids: ids }, context),
      error => error.code === 'cancelled');
    assert.equal(calls, 0);
  });

  test(`${name} forwards cancellation and never starts queued lookups after abort`, async () => {
    const controller = new AbortController();
    const context = { signal: controller.signal };
    const started = deferred();
    let calls = 0;
    const client = { market, [method]: async (_, received) => {
      assert.equal(received, context);
      calls++;
      if (calls === 4) started.resolve();
      await new Promise((resolve, reject) => received.signal.addEventListener('abort',
        () => reject(received.signal.reason), { once: true }));
    } };
    const pending = run(client, { product_ids: ids }, context);
    await started.promise;
    controller.abort();
    await assert.rejects(pending, error => error.code === 'cancelled');
    assert.equal(calls, 4);
  });

  test(`${name} rejects cancellation even when a lookup resolves after abort`, async () => {
    const controller = new AbortController();
    const client = { market, [method]: async ({ product_id }) => {
      controller.abort();
      return resultFor(product_id);
    } };
    await assert.rejects(run(client, { product_ids: ['one'] }, { signal: controller.signal }),
      error => error.code === 'cancelled');
  });
}

test('comparison preserves conditional prices, missing prices and original fetch times through partial failure', async () => {
  const client = { market, getProduct: async ({ product_id }) => {
    if (product_id === 'bad') throw new SuperzooError('not_found', 'Missing product');
    return { ...product(product_id), ...(product_id === 'no-price' ? { price: null } : {}) };
  } };
  const result = await compareProducts(client, { product_ids: ['one', 'bad', 'no-price'] });
  assert.equal(result.complete, false);
  assert.deepEqual(result.products[0].product, product('one'));
  assert.deepEqual(result.products[1], {
    product_id: 'bad', product: null, error: { code: 'not_found', message: 'Missing product', retryable: false },
  });
  assert.equal(result.products[2].product.price, null);
  assert.equal(result.products[2].product.checked_at, oldTime);
  comparisonResultSchema.parse(result);
});

test('common stores match by ID and select metadata from first input observation, independent of completion order', async () => {
  const first = deferred();
  const second = deferred();
  const client = { market, getProductAvailability: async ({ product_id }) => {
    if (product_id === 'one') { await first.promise; return availability('one', [store('a', 'inStock', 'Original')]); }
    second.resolve();
    return availability('two', [store('a', 'inStock', 'Renamed'), store('b', 'inStock', 'Original')], newerTime);
  } };
  const pending = findCommonStores(client, { product_ids: ['one', 'two'] });
  await second.promise;
  first.resolve();
  const result = await pending;
  assert.equal(result.stores.length, 2);
  assert.equal(result.stores[0].name, 'Original');
  assert.equal(result.stores[0].store_id, 'a');
  assert.equal(result.stores[0].all_in_stock, true);
  assert.deepEqual(result.stores[0].products, [
    { product_id: 'one', status: 'inStock', pickup_text: 'zajtra od 11:00', checked_at: oldTime, error: null },
    { product_id: 'two', status: 'inStock', pickup_text: 'zajtra od 11:00', checked_at: newerTime, error: null },
  ]);
  assert.equal(result.stores[1].all_in_stock, false);
  assert.deepEqual(result.stores[1].products[0], {
    product_id: 'one', status: null, pickup_text: null, checked_at: null, error: null,
  });
  assert.deepEqual(result.products, [
    { product_id: 'one', checked_at: oldTime, error: null },
    { product_id: 'two', checked_at: newerTime, error: null },
  ]);
  commonStoresResultSchema.parse(result);
});

for (const status of ['unknown', 'notAvailable', 'available', 'futureCode']) {
  test(`common stores preserve ${status} and require explicit inStock for every product`, async () => {
    const client = { market, getProductAvailability: async ({ product_id }) =>
      availability(product_id, [store('a', product_id === 'one' ? 'inStock' : status)]) };
    const result = await findCommonStores(client, { product_ids: ['one', 'two'] });
    assert.equal(result.complete, true);
    assert.equal(result.stores[0].all_in_stock, false);
    assert.equal(result.stores[0].products[1].status, status);
  });
}

test('common stores report failed products at top level and at every observed store', async () => {
  const client = { market, getProductAvailability: async ({ product_id }) => {
    if (product_id === 'bad') throw new SuperzooError('upstream_unavailable', 'Unavailable', true);
    return availability(product_id, [store(product_id)]);
  } };
  const result = await findCommonStores(client, { product_ids: ['one', 'bad', 'two'] });
  const failure = { code: 'upstream_unavailable', message: 'Unavailable', retryable: true };
  assert.equal(result.complete, false);
  assert.deepEqual(result.products[1], { product_id: 'bad', checked_at: null, error: failure });
  for (const entry of result.stores) {
    assert.equal(entry.products.length, 3);
    assert.equal(entry.all_in_stock, false);
    assert.deepEqual(entry.products[1], {
      product_id: 'bad', status: null, pickup_text: null, checked_at: null, error: failure,
    });
  }
  commonStoresResultSchema.parse(result);
});

test('common stores retain requested IDs and failures when no stores are returned', async () => {
  const client = { market, getProductAvailability: async ({ product_id }) => {
    if (product_id === 'bad') throw new Error('private upstream details');
    return availability(product_id);
  } };
  const result = await findCommonStores(client, { product_ids: ['empty', 'bad'] });
  assert.deepEqual(result.product_ids, ['empty', 'bad']);
  assert.deepEqual(result.stores, []);
  assert.equal(result.complete, false);
  assert.deepEqual(result.products[1].error, {
    code: 'internal_error', message: 'Superzoo request failed', retryable: false,
  });
  commonStoresResultSchema.parse(result);
});

test('common stores delegate accent-insensitive city filtering to the existing client', async () => {
  const client = new SuperzooClient({ fetchImpl: async () => new Response(JSON.stringify({ items: [
    { id: 'a', name: 'Žilina', address: 'Žilina', alias: 'zilina', availability: { status: 'inStock' } },
    { id: 'b', name: 'Košice', address: 'Košice', alias: 'kosice' },
  ] })) });
  const result = await findCommonStores(client, { product_ids: ['one', 'two'], city: '  zilina  ' });
  assert.equal(result.city_filter, 'zilina');
  assert.deepEqual(result.stores.map(s => s.store_id), ['a']);
  assert.equal(result.stores[0].all_in_stock, true);
});

test('common stores reject invalid city filters before lookup', async () => {
  let calls = 0;
  const client = { market, getProductAvailability: async () => { calls++; } };
  for (const city of ['', ' ', 'a'.repeat(101)]) {
    await assert.rejects(findCommonStores(client, { product_ids: ['one'], city }));
  }
  assert.equal(calls, 0);
});

test('comparison reuses cached products without refreshing per-product timestamps', async () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/product-detail.json', import.meta.url)));
  let calls = 0;
  const client = new SuperzooClient({ fetchImpl: async () => {
    calls++;
    return new Response(JSON.stringify(fixture));
  } });
  const original = await client.getProduct({ product_id: '294-101115' });
  const result = await compareProducts(client, { product_ids: ['294-101115'] });
  assert.equal(calls, 1);
  assert.equal(result.products[0].product.checked_at, original.checked_at);
});
