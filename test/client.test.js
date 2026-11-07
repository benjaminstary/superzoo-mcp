import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SuperzooClient } from '../dist/client.js';
import { searchResultSchema } from '../dist/contracts.js';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));
const detail = fixture('product-detail');
const stores = fixture('store-availability');
const response = data => new Response(JSON.stringify(data));
const clientWith = fetchImpl => new SuperzooClient({ fetchImpl });

test('product preserves decimal price context, variant IDs, and availability separately', async () => {
  const client = clientWith(async url => {
    assert.equal(String(url), 'https://www.superzoo.sk/web-api/products/294-101115');
    return response(detail);
  });
  const result = await client.getProduct({ product_id: '294-101115' });
  assert.equal(result.price.amount, '13.99');
  assert.equal(result.price.currency, 'EUR');
  assert.equal(result.price.context, 'public_online');
  assert.equal(result.variants[0].variants[1].id, '294-101116');
  assert.equal(result.availability.availableStoresCount, 44);
  assert.ok(Date.parse(result.checked_at));
});

test('store lookup posts empty JSON and filters city with accents ignored', async () => {
  const client = clientWith(async (url, options) => {
    assert.equal(String(url), 'https://www.superzoo.sk/web-api/products/294-101115/availability');
    assert.equal(options.method, 'POST');
    assert.equal(options.body, '{}');
    return response(stores);
  });
  const result = await client.getProductAvailability({ product_id: '294-101115', city: 'bratislava' });
  assert.ok(result.stores.length > 1);
  assert.ok(result.stores.every(s => s.address.includes('Bratislava') || s.name.includes('Bratislava')));
  const central = result.stores.find(s => s.name === 'Bratislava Central');
  assert.equal(central.url, 'https://www.superzoo.sk/bratislava-central/');
  assert.equal(central.status, 'inStock');
  assert.equal(central.pickup_text, 'zajtra od 11:00');
  assert.equal(central.quantity, null);
  assert.ok(result.stores.some(s => s.status === 'notAvailable'));
});

test('search excludes mixed types, forbidden products, duplicates and restricted price levels; reports partial failures', async () => {
  const product = { id: '294-101115', type: 'productCatalogue.product', title: 'Oil', alias: 'oil', attributes: { productSaleForbidden: ['false'], disallowedPriceLevels: [] } };
  const client = clientWith(async url => {
    url = new URL(url);
    if (url.hostname === 'full-text-search.superzoo.cz') {
      assert.equal(url.searchParams.get('term'), 'brit care');
      assert.equal(url.searchParams.get('f_must_not[0]'), 'productSaleForbidden:true');
      assert.equal(url.searchParams.get('f_must_not[1]'), 'disallowedPriceLevels:22');
      return response({ totalCount: 8, items: [
        { ...product, type: 'productCatalogue.brand' }, product, product,
        { ...product, id: 'bad', attributes: { productSaleForbidden: ['true'] } },
        { ...product, id: 'restricted', attributes: { disallowedPriceLevels: ['22'] } },
        { ...product, id: '294-101116' },
      ] });
    }
    return url.pathname.endsWith('294-101115') ? response(detail) : new Response('no', { status: 503 });
  });
  const result = await client.searchProducts({ query: '  brit care  ', limit: 5 });
  assert.equal(result.products.length, 2);
  assert.equal(result.products[0].price.amount, '13.99');
  assert.equal(result.products[1].price, null);
  assert.match(result.products[1].detail_error, /503/);
  assert.equal(result.upstream_total_count, 8);
  assert.equal(result.total_count_is_product_count, false);
});

test('empty search returns empty products without enrichment requests', async () => {
  const client = clientWith(async () => response({ items: [], totalCount: 0 }));
  assert.deepEqual((await client.searchProducts({ query: 'missing' })).products, []);
});

test('invalid IDs and inputs fail before network access', async () => {
  const client = clientWith(() => assert.fail('unexpected network access'));
  for (const product_id of ['../users', 'a/b', '', 'a?b', 'https://evil.test']) {
    await assert.rejects(client.getProduct({ product_id }));
    await assert.rejects(client.getProductAvailability({ product_id }));
  }
  for (const args of [{ query: '' }, { query: 'x', limit: 0 }, { query: 'x', limit: 51 }, { query: 'x', limit: 1.5 }]) {
    await assert.rejects(client.searchProducts(args));
  }
});

test('upstream errors, invalid JSON and malformed payloads remain errors', async () => {
  for (const makeResponse of [() => new Response('', { status: 429 }), () => new Response('html'), () => response({})]) {
    const client = clientWith(async () => makeResponse());
    await assert.rejects(client.getProduct({ product_id: '294-101115' }));
    await assert.rejects(client.getProductAvailability({ product_id: '294-101115' }));
    await assert.rejects(client.searchProducts({ query: 'x' }));
  }
});

test('timeout aborts the upstream request', async () => {
  const client = new SuperzooClient({ timeoutMs: 10, fetchImpl: async (_, { signal }) => {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 200);
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
    });
  } });
  await assert.rejects(client.getProduct({ product_id: '294-101115' }), /timed out/i);
});

test('unknown store status stays unknown and missing price stays null', async () => {
  const client = clientWith(async url => String(url).endsWith('availability')
    ? response({ items: [{ ...stores.items[0], availability: {} }] })
    : response({ ...detail, price: null }));
  assert.equal((await client.getProduct({ product_id: '294-101115' })).price, null);
  const result = await client.getProductAvailability({ product_id: '294-101115', city: 'SKALICA' });
  assert.equal(result.stores[0].status, 'unknown');
  assert.equal(result.stores[0].quantity, null);
});

test('search bounds detail concurrency, preserves ranking and reports candidate truncation', async () => {
  let active = 0;
  let peak = 0;
  const client = clientWith(async url => {
    url = new URL(url);
    if (url.hostname === 'full-text-search.superzoo.cz') {
      assert.equal(url.searchParams.get('limit'), '200');
      return response({ totalCount: 300, items: Array.from({ length: 8 }, (_, i) => ({
        id: `item-${i}`, type: 'productCatalogue.product', title: `Product ${i}`, alias: `item-${i}`,
        attributes: { productSaleForbidden: ['false'], disallowedPriceLevels: [] },
      })) });
    }
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    const id = url.pathname.split('/').at(-1);
    return response({ ...detail, product: { ...detail.product, id } });
  });
  const result = await client.searchProducts({ query: 'products', limit: 8 });
  assert.equal(peak, 4);
  assert.deepEqual(result.products.map(p => p.product_id), ['item-0', 'item-1', 'item-2', 'item-3', 'item-4', 'item-5', 'item-6', 'item-7']);
  assert.equal(result.candidate_limit_reached, true);
});

test('city filter matches accented names and preserves no-match results as empty', async () => {
  const client = clientWith(async () => response({ items: [{ ...stores.items[0], name: 'Žilina', address: 'Žilina' }] }));
  assert.equal((await client.getProductAvailability({ product_id: '294-101115', city: 'zilina' })).stores.length, 1);
  assert.equal((await client.getProductAvailability({ product_id: '294-101115', city: 'Kosice' })).stores.length, 0);
});

test('simultaneous searches share the four-fetch client budget and duplicate detail work', async () => {
  let active = 0;
  let peak = 0;
  let details = 0;
  const client = clientWith(async url => {
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    const parsed = new URL(url);
    if (parsed.hostname === 'full-text-search.superzoo.cz') return response({ totalCount: 8,
      items: Array.from({ length: 8 }, (_, i) => ({ id: `item-${i}`, title: `Product ${i}`,
        alias: `item-${i}`, type: 'productCatalogue.product' })) });
    details++;
    const id = parsed.pathname.split('/').at(-1);
    return response({ ...detail, product: { ...detail.product, id } });
  });
  const results = await Promise.all([client.searchProducts({ query: 'one', limit: 8 }), client.searchProducts({ query: 'two', limit: 8 })]);
  assert.equal(peak, 4);
  assert.equal(details, 8);
  assert.deepEqual(results[0].products.map(product => product.product_id), results[1].products.map(product => product.product_id));
});

test('availability caches raw stores before city filtering and preserves original timestamps', async () => {
  let calls = 0;
  const client = clientWith(async () => { calls++; return response(stores); });
  const first = await client.getProductAvailability({ product_id: '294-101115', city: 'Bratislava' });
  await new Promise(resolve => setTimeout(resolve, 5));
  const all = await client.getProductAvailability({ product_id: '294-101115' });
  assert.equal(calls, 1);
  assert.equal(all.stores.length, 3);
  assert.equal(first.checked_at, all.checked_at);
});

test('mismatched IDs fail validation before cache insertion', async () => {
  let count = 0;
  const client = clientWith(async () => response(++count === 1
    ? { ...detail, product: { ...detail.product, id: 'different' } } : detail));
  await assert.rejects(client.getProduct({ product_id: '294-101115' }), error => error.code === 'invalid_response');
  assert.equal((await client.getProduct({ product_id: '294-101115' })).product_id, '294-101115');
  assert.equal(count, 2);
});

test('search parent cancellation rejects rather than reporting partial success and stops enrichment', async () => {
  const controller = new AbortController();
  let started = 0;
  const client = clientWith(async (url, { signal }) => {
    if (String(url).includes('full-text-search')) return response({ totalCount: 8, items: Array.from({ length: 8 }, (_, i) => ({
      id: `item-${i}`, title: 'Product', alias: `item-${i}`, type: 'productCatalogue.product',
    })) });
    started++;
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      if (started === 4) controller.abort();
    });
  });
  await assert.rejects(client.searchProducts({ query: 'oil', limit: 8 }, { signal: controller.signal }), error => error.code === 'cancelled');
  assert.equal(started, 4);
});

test('client forwards cancellation for product and availability without aborting another caller', async () => {
  for (const method of ['getProduct', 'getProductAvailability']) {
    let finish;
    let upstreamSignal;
    let calls = 0;
    const client = clientWith(async (_, { signal }) => {
      calls++;
      upstreamSignal = signal;
      return new Promise(resolve => { finish = () => resolve(response(method === 'getProduct' ? detail : stores)); });
    });
    const controller = new AbortController();
    const cancelled = client[method]({ product_id: '294-101115' }, { signal: controller.signal });
    const survivor = client[method]({ product_id: '294-101115' });
    const rejected = assert.rejects(cancelled, error => error.code === 'cancelled');
    controller.abort();
    await rejected;
    assert.equal(upstreamSignal.aborted, false);
    finish();
    assert.equal((await survivor).product_id, '294-101115');
    assert.equal(calls, 1);
  }
});

const candidateDetail = (id, overrides = {}) => ({
  ...detail, ...overrides, product: { ...detail.product, id, ...overrides.product },
});
const searchCandidate = id => ({ id, title: `Candidate ${id}`, alias: id, type: 'productCatalogue.product' });
const catalogueClient = (entries, options = {}) => {
  const calls = [];
  const items = options.items ?? Object.keys(entries).map(searchCandidate);
  const client = clientWith(async url => {
    const parsed = new URL(url);
    if (parsed.hostname === 'full-text-search.superzoo.cz') {
      assert.equal(parsed.searchParams.get('limit'), '200');
      for (const filter of ['brand', 'min_price', 'max_price', 'online_only', 'page', 'offset']) {
        assert.equal(parsed.searchParams.has(filter), false);
      }
      return response({ items, totalCount: options.totalCount ?? items.length });
    }
    const id = parsed.pathname.split('/').at(-1);
    calls.push(id);
    const value = entries[id];
    return value instanceof Response ? value.clone() : response(value);
  });
  return { client, calls };
};

test('brand filtering uses enriched exact names, ignoring case and accents, and scans past nonmatches', async () => {
  const { client, calls } = catalogueClient({
    wrong: candidateDetail('wrong', { product: { brand: { name: 'Brit Care Mini' } } }),
    unknown: candidateDetail('unknown', { product: { brand: null } }),
    match: candidateDetail('match', { product: { brand: { name: 'Brít Čare' } } }),
    unnecessary: candidateDetail('unnecessary'),
  });
  const result = await client.searchProducts({ query: 'food', limit: 1, brand: '  BRIT CARE  ' });
  assert.deepEqual(result.products.map(p => p.product_id), ['match']);
  assert.deepEqual(calls, ['wrong', 'unknown', 'match']);
  assert.deepEqual(result.filters_applied, { brand: 'BRIT CARE' });
  assert.equal(result.products_checked, 3);
  assert.equal(result.requested_limit_filled, true);
  assert.equal(result.detail_failures, 0);
  assert.deepEqual(searchResultSchema.parse(result), result);
});

for (const [min_price, max_price, expected] of [
  ['0.10', '9.99', ['ten-cents', 'nine']],
  ['9.99', '10.00', ['nine', 'ten']],
  ['0.1000', '00.10', ['ten-cents']],
  [undefined, '0.10', ['low', 'ten-cents']],
  ['10.00', undefined, ['ten', 'high']],
]) {
  test(`price range ${min_price ?? '*'} to ${max_price ?? '*'} includes exact decimal boundaries`, async () => {
    const { client } = catalogueClient(Object.fromEntries([
      ['low', '0.09'], ['ten-cents', '0.10'], ['nine', '9.99'], ['ten', '10.00'], ['high', '10.01'],
    ].map(([id, amount]) => [id, candidateDetail(id, { price: { sellPrice: amount } })])));
    const result = await client.searchProducts({ query: 'food', min_price, max_price });
    assert.deepEqual(result.products.map(p => p.product_id), expected);
    assert.equal(result.products_checked, 5);
  });
}

test('decimal filters preserve differences beyond binary floating-point precision', async () => {
  const { client } = catalogueClient({
    low: candidateDetail('low', { price: { sellPrice: '9007199254740992.0000000000000001' } }),
    exact: candidateDetail('exact', { price: { sellPrice: '9007199254740992.0000000000000002' } }),
    high: candidateDetail('high', { price: { sellPrice: '9007199254740992.0000000000000003' } }),
  });
  const result = await client.searchProducts({ query: 'food',
    min_price: '9007199254740992.0000000000000002', max_price: '9007199254740992.0000000000000002' });
  assert.deepEqual(result.products.map(p => p.product_id), ['exact']);
});

test('invalid filters and reversed exact decimal ranges reject before network access', async () => {
  let calls = 0;
  const client = clientWith(async () => { calls++; return response({ items: [], totalCount: 0 }); });
  for (const filters of [
    { brand: '' }, { brand: '   ' }, { brand: 'a'.repeat(101) },
    { online_only: 'true' }, { min_price: 1 }, { min_price: '-1' }, { min_price: '.10' },
    { min_price: '1.' }, { max_price: '1e2' }, { max_price: ' 10' }, { min_price: 'NaN' },
    { min_price: '10.00', max_price: '9.99' },
    { min_price: '1.0000000000000002', max_price: '1.0000000000000001' },
  ]) {
    await assert.rejects(client.searchProducts({ query: 'food', ...filters }));
  }
  assert.equal(calls, 0);
});

test('price filtering omits missing offers and amounts while retaining conditional price labels', async () => {
  const { client } = catalogueClient({
    absent: candidateDetail('absent', { price: null }),
    missing: candidateDetail('missing', { price: {} }),
    conditional: candidateDetail('conditional', {
      price: { sellPrice: '13.99', originalPrice: '39.99', variant: 'familyPrice', voucherCampaign: { label: 'conditional' } },
    }),
  });
  const result = await client.searchProducts({ query: 'food', min_price: '10.00', max_price: '14.00' });
  assert.deepEqual(result.products.map(p => p.product_id), ['conditional']);
  assert.equal(result.products[0].price.amount, '13.99');
  assert.equal(result.products[0].price.original_amount, '39.99');
  assert.equal(result.products[0].price.variant, 'familyPrice');
  assert.deepEqual(result.products[0].price.voucher_campaign, { label: 'conditional' });
  assert.equal(result.detail_failures, 0);
});

test('online-only filtering requires the verified delivery code independently of store stock and canBuy', async () => {
  const { client } = catalogueClient(Object.fromEntries([
    ['available', { deliveryAvailability: { availability: 'available', text: 'tomorrow' } }],
    ['unavailable', { deliveryAvailability: { availability: 'notAvailable', text: 'niedostępne' }, storeAvailability: { availability: 'available' } }],
    ['store-only', { storeAvailability: { availability: 'inStock' }, availableStoresCount: 50 }],
    ['wrong-code', { deliveryAvailability: { availability: 'inStock' } }],
    ['future-code', { deliveryAvailability: { availability: 'futureCode' } }],
    ['missing-code', { deliveryAvailability: {} }],
    ['null-code', { deliveryAvailability: { availability: null } }],
    ['missing', null],
  ].map(([id, availability]) => [id, candidateDetail(id, { availability })])));
  const result = await client.searchProducts({ query: 'food', online_only: true });
  assert.deepEqual(result.products.map(p => p.product_id), ['available']);
  assert.equal(result.products[0].availability.deliveryAvailability.text, 'tomorrow');
  assert.deepEqual(result.filters_applied, { online_only: true });
  assert.equal(result.products_checked, 8);
});

test('combined filters require every predicate while preserving upstream order', async () => {
  const delivery = code => ({ deliveryAvailability: { availability: code } });
  const { client } = catalogueClient({
    brand: candidateDetail('brand', { product: { brand: { name: 'Other' } }, availability: delivery('available') }),
    price: candidateDetail('price', { price: { sellPrice: '0.01' }, availability: delivery('available') }),
    delivery: candidateDetail('delivery', { availability: delivery('notAvailable') }),
    first: candidateDetail('first', { availability: delivery('available') }),
    second: candidateDetail('second', { availability: delivery('available') }),
  });
  const result = await client.searchProducts({ query: 'food', limit: 2, brand: 'Brit Care', min_price: '1', online_only: true });
  assert.deepEqual(result.products.map(p => p.product_id), ['first', 'second']);
  assert.equal(result.products_checked, 5);
});

for (const filters of [{}, { online_only: false }]) {
  test(`inactive filters ${JSON.stringify(filters)} retain missing fields and partial failures`, async () => {
    const { client, calls } = catalogueClient({
      missing: candidateDetail('missing', { price: null, product: { brand: null }, availability: null }),
      failed: new Response('', { status: 404 }),
      unnecessary: candidateDetail('unnecessary'),
    });
    const result = await client.searchProducts({ query: 'food', limit: 2, ...filters });
    assert.deepEqual(result.products.map(p => p.product_id), ['missing', 'failed']);
    assert.equal(result.products[0].price, null);
    assert.match(result.products[1].detail_error, /404/);
    assert.equal(result.products[1].availability, null);
    assert.deepEqual(calls, ['missing', 'failed']);
    assert.equal(result.detail_failures, 1);
    assert.equal(result.products_checked, 2);
    assert.deepEqual(result.filters_applied, filters);
    assert.deepEqual(searchResultSchema.parse(result), result);
  });
}

for (const filters of [{ brand: 'Brit Care' }, { min_price: '0' }, { max_price: '100' }, { online_only: true }]) {
  test(`active filter ${JSON.stringify(filters)} omits and counts failed details and continues scanning`, async () => {
    const { client } = catalogueClient({
      failed: new Response('', { status: 404 }),
      found: candidateDetail('found'),
    });
    const result = await client.searchProducts({ query: 'food', limit: 1, ...filters });
    assert.deepEqual(result.products.map(p => p.product_id), ['found']);
    assert.equal(result.detail_failures, 1);
    assert.equal(result.products_checked, 2);
    assert.equal(result.requested_limit_filled, true);
  });
}

test('filtered search respects the first 200 upstream items and reports bounded coverage', async () => {
  const entries = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [
    `item-${i}`, candidateDetail(`item-${i}`, { product: { brand: { name: i === 200 ? 'Match' : 'Other' } } }),
  ]));
  const { client, calls } = catalogueClient(entries, { totalCount: 500 });
  const result = await client.searchProducts({ query: 'food', limit: 1, brand: 'Match' });
  assert.deepEqual(result.products, []);
  assert.equal(calls.length, 200);
  assert.equal(calls.includes('item-200'), false);
  assert.equal(result.products_checked, 200);
  assert.equal(result.candidates_checked, 200);
  assert.equal(result.upstream_total_count, 500);
  assert.equal(result.total_count_is_product_count, false);
  assert.equal(result.candidate_limit_reached, true);
  assert.equal(result.requested_limit_filled, false);
  assert.equal(result.coverage, 'bounded_candidates');
});

test('filtered search excludes ineligible candidates before enrichment and keeps legacy candidate counters', async () => {
  const { client, calls } = catalogueClient({ match: candidateDetail('match') }, { totalCount: 9, items: [
    { ...searchCandidate('brand'), type: 'productCatalogue.brand' },
    { ...searchCandidate('forbidden'), attributes: { productSaleForbidden: ['true'] } },
    { ...searchCandidate('restricted'), attributes: { disallowedPriceLevels: ['22'] } },
    searchCandidate('match'), searchCandidate('match'),
  ] });
  const result = await client.searchProducts({ query: 'food', brand: 'Brit Care' });
  assert.deepEqual(result.products.map(p => p.product_id), ['match']);
  assert.deepEqual(calls, ['match']);
  assert.equal(result.candidates_checked, 5);
  assert.equal(result.products_checked, 1);
  assert.equal(result.candidate_limit_reached, true);
  assert.equal(result.requested_limit_filled, false);
});

test('empty filtered search returns explicit metadata without detail work', async () => {
  const { client, calls } = catalogueClient({});
  const result = await client.searchProducts({ query: 'food', min_price: '0' });
  assert.deepEqual(result.products, []);
  assert.deepEqual(calls, []);
  assert.deepEqual(result.filters_applied, { min_price: '0' });
  assert.equal(result.products_checked, 0);
  assert.equal(result.detail_failures, 0);
  assert.equal(result.coverage, 'bounded_candidates');
  assert.equal(result.candidate_limit_reached, false);
});

test('filtered enrichment keeps four active lookups at most and stable ranking across completion order', async () => {
  let active = 0;
  let peak = 0;
  const client = clientWith(async url => {
    const parsed = new URL(url);
    if (parsed.hostname === 'full-text-search.superzoo.cz') {
      return response({ totalCount: 12, items: Array.from({ length: 12 }, (_, i) => searchCandidate(`item-${i}`)) });
    }
    const id = parsed.pathname.split('/').at(-1);
    const index = Number(id.slice(5));
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, index % 4 === 0 ? 10 : 1));
    active--;
    return response(candidateDetail(id, { product: { brand: { name: index % 2 ? 'Match' : 'Other' } } }));
  });
  const result = await client.searchProducts({ query: 'food', limit: 5, brand: 'Match' });
  assert.equal(peak, 4);
  assert.deepEqual(result.products.map(p => p.product_id), ['item-1', 'item-3', 'item-5', 'item-7', 'item-9']);
  assert.equal(result.requested_limit_filled, true);
});

test('filtered search cancellation rejects and prevents new windows after parent abort', async () => {
  const controller = new AbortController();
  let started = 0;
  const client = clientWith(async (url, { signal }) => {
    if (String(url).includes('full-text-search')) {
      return response({ totalCount: 10, items: Array.from({ length: 10 }, (_, i) => searchCandidate(`item-${i}`)) });
    }
    started++;
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      if (started === 4) controller.abort();
    });
  });
  await assert.rejects(client.searchProducts({ query: 'food', limit: 5, brand: 'Match' }, { signal: controller.signal }),
    error => error.code === 'cancelled');
  assert.equal(started, 4);
});

test('filtered searches reuse cached details without refreshing their retrieval timestamps', async () => {
  const { client, calls } = catalogueClient({ match: candidateDetail('match') });
  const original = await client.getProduct({ product_id: 'match' });
  const result = await client.searchProducts({ query: 'food', brand: 'Brit Care' });
  assert.equal(result.products[0].checked_at, original.checked_at);
  assert.equal(result.products_checked, 1);
  assert.deepEqual(calls, ['match']);
});
