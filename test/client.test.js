import { catalogueFetch } from './helpers/catalogue-fetch.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SuperzooClient } from '../dist/client.js';
import { searchResultSchema } from '../dist/contracts.js';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));
const detail = fixture('product-detail');
const enrichment = fixture('product-detail-enrichment');
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
  assert.equal(result.rating, null);
  assert.deepEqual(result.attributes, []);
  assert.equal(result.price.unit_price, null);
  assert.equal(result.price.original_unit_price, null);
  assert.ok(Date.parse(result.checked_at));
});

test('product exposes localized details and upstream unit prices in the offer currency', async () => {
  const client = new SuperzooClient({ country: 'PL', fetchImpl: async () => response({
    ...detail, ...enrichment, price: { ...detail.price, ...enrichment.price, sellPrice: '84.99' },
  }) });
  const result = await client.getProduct({ product_id: detail.product.id });
  assert.deepEqual(result.rating, { value: 90, count: 23 });
  assert.deepEqual(result.attributes, [{ name: 'Gramatura', value: '3 kg' }]);
  assert.equal(result.price.currency, 'PLN');
  assert.deepEqual(result.price.unit_price, { amount: '2.83', unit_size: '100', unit: 'g' });
  assert.deepEqual(result.price.original_unit_price, result.price.unit_price);
});

test('malformed optional details leave valid attributes, prices, and product data intact', async () => {
  for (const badUnit of [{ unit: undefined }, { unitSize: '0.00' }, { unitSize: '-1' }, { unitPrice: 2.83 }]) {
    const client = clientWith(async () => response({
      ...detail,
      rating: { rating: 90, ratingCount: '23' },
      parameters: [null, { name: 'Typ', value: 'Karma', position: 2 }, { name: 'Broken', value: 5 },
        { name: ' ', value: 'Unknown' }, ...enrichment.parameters],
      price: { ...detail.price, variant: 'familyPrice',
        sellUnitPrice: { ...enrichment.price.sellUnitPrice, ...badUnit },
        originalUnitPrice: { unitPrice: '1.230', unitSize: '0.50', unit: 'kg' } },
    }));
    const result = await client.getProduct({ product_id: detail.product.id });
    assert.equal(result.name, detail.product.name);
    assert.equal(result.rating, null);
    assert.deepEqual(result.attributes, [{ name: 'Typ', value: 'Karma' }, { name: 'Gramatura', value: '3 kg' }]);
    assert.equal(result.price.amount, '13.99');
    assert.equal(result.price.variant, 'familyPrice');
    assert.equal(result.price.unit_price, null);
    assert.deepEqual(result.price.original_unit_price, { amount: '1.230', unit_size: '0.50', unit: 'kg' });
  }
});

test('valid optional details survive an absent price and malformed parameter list', async () => {
  const { price, ...unpriced } = detail;
  const client = clientWith(async () => response({ ...unpriced, rating: enrichment.rating, parameters: {} }));
  const result = await client.getProduct({ product_id: detail.product.id });
  assert.equal(result.price, null);
  assert.deepEqual(result.rating, { value: 90, count: 23 });
  assert.deepEqual(result.attributes, []);
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

test('store locator sends an anonymous coordinate pair and returns only the nearest branch', async () => {
  const source = 'https://www.superzoo.sk/web-api/stores/nearest-store';
  const client = clientWith(async (url, options) => {
    assert.equal(String(url), source);
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.headers.get('Content-Type'), 'application/json');
    assert.equal(options.headers.has('Authorization'), false);
    assert.equal(options.headers.has('Cookie'), false);
    assert.equal(options.redirect, 'error');
    assert.deepEqual(JSON.parse(options.body), { latitude: 48.15, longitude: 17.11 });
    return response(fixture('nearest-store'));
  });
  const { checked_at, ...result } = await client.findStores({ latitude: 48.15, longitude: 17.11 });
  assert.ok(Number.isFinite(Date.parse(checked_at)));
  assert.deepEqual(result, {
    market: 'SK', source, coverage: 'nearest_store',
    stores: [{
      store_id: 'SKPIC-400', name: 'Bratislava Aupark Shopping Center', address: 'Einsteinova 18, Bratislava',
      latitude: 48.133312, longitude: 17.106619,
    }],
  });
});

test('store locator rejects invalid inputs and unsupported markets before network access', async () => {
  const fetchImpl = () => assert.fail('unexpected network access');
  const client = clientWith(fetchImpl);
  const valid = { latitude: 0, longitude: 0 };
  for (const input of [{}, { latitude: 0 }, { longitude: 0 }, { ...valid, latitude: 91 },
    { ...valid, longitude: -181 }, { ...valid, latitude: '0' }, { ...valid, longitude: Infinity },
    { ...valid, city: 'Bratislava' }, { ...valid, limit: 1 }]) {
    await assert.rejects(client.findStores(input), { name: 'ZodError' });
  }
  const unsupported = new SuperzooClient({ country: 'PL', fetchImpl });
  await assert.rejects(unsupported.findStores(valid), /not supported in Poland/);
});

test('store locator distinguishes an explicit empty result from a malformed response', async () => {
  const input = { latitude: 0, longitude: 0 };
  const empty = await clientWith(async () => response({ nearestStore: null })).findStores(input);
  assert.equal(empty.coverage, 'nearest_store');
  assert.deepEqual(empty.stores, []);
  for (const payload of [{}, { nearestStore: { id: ' ', name: 'Branch', address: 'Street' } }]) {
    await assert.rejects(clientWith(async () => response(payload)).findStores(input), { code: 'invalid_response' });
  }
});

test('store locator keeps branch identity when upstream coordinates are invalid or missing', async () => {
  const client = clientWith(async () => response({
    nearestStore: { id: 'SKPIC-400', name: 'Branch', address: 'Street', latitude: '48' },
  }));
  const result = await client.findStores({ latitude: 0, longitude: 0 });
  assert.deepEqual(result.stores, [{
    store_id: 'SKPIC-400', name: 'Branch', address: 'Street', latitude: null, longitude: null,
  }]);
});

const quoteItem = { productId: '294-101115', quantity: 1 };
const quoteInput = { product_id: quoteItem.productId };
const shippingQuote = (options = {}) => ({ shippingOptions: {
  shipment: { items: [quoteItem] }, items: [quoteItem], deliveryMethods: [], personalPickups: [], ...options,
} });

test('delivery quote sends one unit anonymously and preserves prices, dates and pickup associations', async () => {
  const source = 'https://logistics.superzoo.cz/api/actions/calculate-product-shipping-options';
  const price = { amountIncVat: '3.99', currency: 'EUR' };
  const deliveryDate = '2026-11-25T13:00:00+01:00';
  const client = clientWith(async (url, options) => {
    assert.equal(String(url), source);
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.headers.get('Content-Type'), 'application/json');
    assert.equal(options.redirect, 'error');
    assert.deepEqual(JSON.parse(options.body), { webId: 'superzoo_sk', product: quoteItem });
    return response(shippingQuote({
      deliveryMethods: [{ deliveryMethodId: 'eed7a79d-1dc4-430f-bccd-ca291c8caaef',
        name: 'Packeta – Doručenie na adresu', price, deliveryDate, isPriceFrom: false }],
      personalPickups: [
        { personalPickupId: 'PERSONAL_PICKUP_SK', name: 'Osobný odber v predajni', isStore: true,
          price: { ...price, amountIncVat: '0' }, deliveryDate: null,
          places: [{ pickupPlaceId: 'SKPIC-880', personalPickupId: 'PERSONAL_PICKUP_SK', name: 'Trnava Storia',
            isAvailable: true, deliveryDate: '2026-11-23T15:44:00+01:00', extraFee: null }] },
        { personalPickupId: 'SKDEL-PACKETA', name: 'Packeta – Výdajné miesto', isStore: false,
          price: { ...price, amountIncVat: '2.99' }, deliveryDate, places: [] },
      ],
    }));
  });
  const { checked_at, ...result } = await client.getDeliveryOptions(quoteInput);
  assert.ok(Number.isFinite(Date.parse(checked_at)));
  assert.deepEqual(result, {
    ...quoteInput, quantity: 1, market: 'SK', source,
    delivery_methods: [{ method_id: 'eed7a79d-1dc4-430f-bccd-ca291c8caaef',
      name: 'Packeta – Doručenie na adresu', price: { amount: '3.99', currency: 'EUR' },
      delivery_date: deliveryDate, is_price_from: false }],
    pickup_methods: [
      { method_id: 'PERSONAL_PICKUP_SK', name: 'Osobný odber v predajni', is_store: true,
        price: { amount: '0', currency: 'EUR' }, delivery_date: null,
        places: [{ place_id: 'SKPIC-880', name: 'Trnava Storia', is_available: true,
          delivery_date: '2026-11-23T15:44:00+01:00', extra_fee: null }] },
      { method_id: 'SKDEL-PACKETA', name: 'Packeta – Výdajné miesto', is_store: false,
        price: { amount: '2.99', currency: 'EUR' }, delivery_date: deliveryDate, places: [] },
    ],
  });
});

test('delivery quote sends two units and reports the verified quantity', async () => {
  const product = { ...quoteItem, quantity: 2 };
  const client = clientWith(async (url, options) => {
    assert.deepEqual(JSON.parse(options.body), { webId: 'superzoo_sk', product });
    return response(shippingQuote({ shipment: { items: [product] }, items: undefined }));
  });
  const result = await client.getDeliveryOptions({ ...quoteInput, quantity: 2 });
  assert.equal(result.product_id, product.productId);
  assert.equal(result.quantity, 2);
});

test('delivery quote rejects a mismatched or extra echoed item for two units', async () => {
  const product = { ...quoteItem, quantity: 2 };
  for (const items of [[quoteItem], [{ ...product, productId: 'different' }], [product, product]]) {
    for (const options of [
      { shipment: { items }, items: [product] },
      { shipment: { items: [product] }, items },
    ]) {
      const client = clientWith(async () => response(shippingQuote(options)));
      await assert.rejects(client.getDeliveryOptions({ ...quoteInput, quantity: 2 }), { code: 'invalid_response' });
    }
  }
});

test('delivery quote keeps unknown optional fields nullable and preserves explicit false and zero', async () => {
  const client = clientWith(async () => response(shippingQuote({
    deliveryMethods: [{ deliveryMethodId: 'delivery', name: 'Courier',
      price: { amountIncVat: '99', currency: 'CZK' }, deliveryDate: 'unknown', isPriceFrom: 'false' }],
    personalPickups: [{ personalPickupId: 'pickup', name: 'Pickup', price: null, places: [
      { pickupPlaceId: 'one', personalPickupId: 'pickup', name: 'One', isAvailable: false,
        extraFee: { amountIncVat: '0.00', currency: 'EUR' } },
      { pickupPlaceId: 'two', personalPickupId: 'pickup', name: 'Two' },
    ] }],
  })));
  const result = await client.getDeliveryOptions(quoteInput);
  assert.deepEqual(result.delivery_methods, [{
    method_id: 'delivery', name: 'Courier', price: null, delivery_date: null, is_price_from: null,
  }]);
  assert.deepEqual(result.pickup_methods, [{
    method_id: 'pickup', name: 'Pickup', price: null, delivery_date: null, is_store: null,
    places: [
      { place_id: 'one', name: 'One', is_available: false, delivery_date: null, extra_fee: { amount: '0.00', currency: 'EUR' } },
      { place_id: 'two', name: 'Two', is_available: null, delivery_date: null, extra_fee: null },
    ],
  }]);
});

test('delivery quote distinguishes empty options from malformed, mismatched, and unavailable responses', async () => {
  const empty = await clientWith(async () => response(shippingQuote())).getDeliveryOptions(quoteInput);
  assert.deepEqual(empty.delivery_methods, []);
  assert.deepEqual(empty.pickup_methods, []);
  for (const payload of [
    {},
    shippingQuote({ deliveryMethods: null }),
    shippingQuote({ shipment: { items: [{ ...quoteItem, productId: 'different' }] } }),
    shippingQuote({ shipment: { items: [{ ...quoteItem, quantity: 2 }] } }),
    shippingQuote({ items: [{ ...quoteItem, productId: 'different' }] }),
    shippingQuote({ personalPickups: [{ personalPickupId: 'pickup', name: 'Pickup',
      places: [{ pickupPlaceId: 'place', personalPickupId: 'other', name: 'Place' }] }] }),
  ]) {
    await assert.rejects(clientWith(async () => response(payload)).getDeliveryOptions(quoteInput), { code: 'invalid_response' });
  }
  const unavailable = clientWith(async () => new Response('', { status: 503, headers: { 'Retry-After': '60' } }));
  await assert.rejects(unavailable.getDeliveryOptions(quoteInput), { code: 'upstream_unavailable' });
});

test('delivery quote rejects invalid input, unsupported markets, and cancellation before network access', async () => {
  const fetchImpl = () => assert.fail('unexpected network access');
  const client = clientWith(fetchImpl);
  for (const input of [{}, { product_id: '../product' }, { ...quoteInput, postal_code: '81101' }]) {
    await assert.rejects(client.getDeliveryOptions(input), { name: 'ZodError' });
  }
  for (const quantity of [0, 1.5, '2', 3]) {
    await assert.rejects(client.getDeliveryOptions({ ...quoteInput, quantity }), { name: 'ZodError' });
  }
  const unsupported = new SuperzooClient({ country: 'PL', fetchImpl });
  await assert.rejects(unsupported.getDeliveryOptions(quoteInput), { code: 'not_found' });
  await assert.rejects(unsupported.getDeliveryOptions({ ...quoteInput, quantity: 2 }), { code: 'not_found' });
  await assert.rejects(client.getDeliveryOptions(quoteInput, { signal: AbortSignal.abort() }), { code: 'cancelled' });
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

const dogFoodId = '42eeee01-5544-4e68-8130-bef9755298ae';
const categoryFilterUrl = 'https://parameter-filter.superzoo.cz/filter-products/superzoo_cz';
const categoryProductUrl = 'https://read-model.superzoo.cz/collections/product/webs/superzoo_cz/languages/cs/documents/filter';

function categoryRecord(id) {
  return {
    product: { productId: id, name: `Dog food ${id}`, alias: `dog-food-${id}`,
      published: true, productSaleForbidden: false, disallowedPriceLevels: [] },
    prices: [{ productId: id, webId: 'superzoo_cz', priceLevelId: '1' }],
  };
}

test('category browse uses the filter scope ID, joins in filter order, and excludes ineligible products', async () => {
  const ids = ['294-170845', 'unpublished', 'forbidden', 'blocked', 'no-price', 'wrong-product', 'wrong-web', 'wrong-level', '294-170827'];
  const records = ids.map(categoryRecord);
  records[1].product.published = false;
  records[2].product.productSaleForbidden = true;
  records[3].product.disallowedPriceLevels = ['1'];
  records[4].prices = [];
  records[5].prices[0].productId = '294-170845';
  records[6].prices[0].webId = 'superzoo_sk';
  records[7].prices[0].priceLevelId = '22';
  records[8].product.disallowedPriceLevels = ['22'];
  const calls = [];
  const client = new SuperzooClient({ country: 'CZ', fetchImpl: catalogueFetch('CZ', async (url, options) => {
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.get('Content-Type'), 'application/json');
    calls.push([String(url), JSON.parse(options.body)]);
    return String(url) === categoryFilterUrl
      ? response({ products: ids.map(id => ({ id })), totalCount: 222 })
      : response({ items: records.reverse() });
  }) });
  const facets = { 'stari-psa': 'senior' };
  const result = await client.browseProducts({ category_id: dogFoodId, facets });
  assert.deepEqual(calls, [
    [categoryFilterUrl, {
      priceLevel: '1', scope: { category: 'c1955f56-7438-4c93-8875-9dc8f634acd9' },
      filters: { onlyOnSale: true, onlyInStock: false, promotedOnly: false },
      facets: ['brands', 'parameters', 'campaigns', 'categories', 'reviews', 'prices', 'tags'],
      query: { parameters: [{ alias: 'stari-psa', values: ['senior'] }] },
      paging: { page: 1, limit: 10 },
    }],
    [categoryProductUrl, { ids }],
  ]);
  assert.equal(result.market, 'CZ');
  assert.equal(result.category_id, dogFoodId);
  assert.equal(result.source, categoryFilterUrl);
  assert.equal(result.product_source, categoryProductUrl);
  assert.ok(Date.parse(result.checked_at));
  assert.equal(result.coverage, 'first_page');
  assert.equal(result.page, 1);
  assert.equal(result.next_page, 2);
  assert.deepEqual(result.facets_applied, facets);
  assert.equal(result.upstream_total_count, 222);
  assert.equal(result.candidates_checked, ids.length);
  assert.equal(result.eligible_count, 2);
  assert.deepEqual(result.products, ['294-170845', '294-170827'].map(id => ({
    product_id: id, name: `Dog food ${id}`, url: `https://www.superzoo.cz/dog-food-${id}/`,
  })));
});

test('empty category page skips the product join and sends the unfiltered query', async () => {
  const calls = [];
  const client = new SuperzooClient({ country: 'CZ', fetchImpl: catalogueFetch('CZ', async (url, options) => {
    calls.push([String(url), JSON.parse(options.body).query]);
    return response({ products: [], totalCount: 0 });
  }) });
  const result = await client.browseProducts({ category_id: dogFoodId });
  assert.deepEqual(calls, [[categoryFilterUrl, {}]]);
  assert.deepEqual(result.facets_applied, {});
  assert.equal(result.upstream_total_count, 0);
  assert.equal(result.candidates_checked, 0);
  assert.equal(result.next_page, null);
  assert.equal(result.eligible_count, 0);
  assert.equal(result.product_source, null);
  assert.deepEqual(result.products, []);
});

test('category browsing advances on the upstream count even when no products are eligible', async () => {
  const calls = [];
  const client = new SuperzooClient({ country: 'CZ', fetchImpl: catalogueFetch('CZ', async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    if (String(url) === categoryFilterUrl) {
      return response({ totalCount: 21, products: body.paging.page <= 3 ? [{ id: `294-${body.paging.page}` }] : [] });
    }
    const record = categoryRecord(body.ids[0]);
    record.product.productSaleForbidden = true;
    return response({ items: [record] });
  }) });
  const facets = { 'stari-psa': 'senior' };
  for (const [page, next_page, candidates_checked] of [[2, 3, 1], [3, null, 1], [4, null, 0]]) {
    const result = await client.browseProducts({ category_id: dogFoodId, facets, page });
    assert.equal(result.page, page);
    assert.equal(result.coverage, 'category_page');
    assert.equal(result.next_page, next_page);
    assert.equal(result.candidates_checked, candidates_checked);
    assert.deepEqual(result.products, []);
    assert.deepEqual(result.facets_applied, facets);
  }
  assert.deepEqual(calls.filter(call => call.paging).map(call => [call.paging, call.query]), [2, 3, 4].map(page => [
    { page, limit: 10 }, { parameters: [{ alias: 'stari-psa', values: ['senior'] }] },
  ]));
  assert.deepEqual(calls.filter(call => call.ids), [{ ids: ['294-2'] }, { ids: ['294-3'] }]);
});

test('category browse rejects malformed inputs and unsupported markets before fetching', async () => {
  const calls = [];
  const client = new SuperzooClient({ country: 'CZ', fetchImpl: async url => { calls.push(url); } });
  for (const args of [
    {}, { category_id: 'invalid category id' },
    ...[0, -1, 1.5, '2', Number.MAX_SAFE_INTEGER + 1].map(page => ({ category_id: dogFoodId, page })),
    { category_id: dogFoodId, facets: { 'stari-psa': { from: 5, to: 1 } } },
    { category_id: dogFoodId, facets: { 'stari-psa': [] } },
    { category_id: dogFoodId, facets: { unsupported: true } },
  ]) {
    await assert.rejects(() => client.browseProducts(args), { name: 'ZodError' });
  }
  await assert.rejects(() => client.listProductCategories({ limit: 1 }), { name: 'ZodError' });
  const unsupported = new SuperzooClient({ country: 'PL', fetchImpl: async url => { calls.push(url); } });
  await assert.rejects(() => unsupported.listProductCategories({}), { code: 'not_found' });
  await assert.rejects(() => unsupported.browseProducts({ category_id: dogFoodId }), { code: 'not_found' });
  assert.deepEqual(calls, []);
});

test('category browse skips missing product records and preserves continuation', async () => {
  const ids = ['missing', '294-170845'];
  for (const items of [[], [categoryRecord(ids[1])]]) {
    const client = new SuperzooClient({ country: 'CZ', fetchImpl: catalogueFetch('CZ', async url => response(
      String(url) === categoryFilterUrl ? { products: ids.map(id => ({ id })), totalCount: 30 } : { items },
    )) });
    const result = await client.browseProducts({ category_id: dogFoodId, page: 2 });
    assert.equal(result.next_page, 3);
    assert.equal(result.candidates_checked, 2);
    assert.equal(result.eligible_count, items.length);
    assert.deepEqual(result.products.map(product => product.product_id), items.map(item => item.product.productId));
  }
});

test('category browse rejects unexpected, duplicate, or malformed product records', async () => {
  const id = '294-170845';
  const missingRestriction = categoryRecord(id);
  delete missingRestriction.product.productSaleForbidden;
  const malformedRestriction = categoryRecord(id);
  malformedRestriction.product.disallowedPriceLevels = [1];
  for (const items of [[categoryRecord('wrong-id')], [categoryRecord(id), categoryRecord(id)],
    [missingRestriction], [malformedRestriction]]) {
    const client = new SuperzooClient({ country: 'CZ', fetchImpl: catalogueFetch('CZ', async url => response(
      String(url) === categoryFilterUrl ? { products: [{ id }, { id: 'another-id' }], totalCount: 2 } : { items },
    )) });
    await assert.rejects(() => client.browseProducts({ category_id: dogFoodId }), { code: 'invalid_response' });
  }
});

test('category browse rejects malformed or out-of-bounds filter pages before joining', async () => {
  for (const page of [
    { products: [{ id: '294-170845' }], totalCount: 0 },
    { products: [{ id: '294-170845' }, { id: '294-170845' }], totalCount: 2 },
    { products: Array.from({ length: 11 }, (_, index) => ({ id: `294-${index}` })), totalCount: 11 },
    { products: [{ id: 170845 }], totalCount: 1 },
  ]) {
    const calls = [];
    const client = new SuperzooClient({ country: 'CZ', fetchImpl: catalogueFetch('CZ', async url => {
      calls.push(String(url));
      return response(page);
    }) });
    await assert.rejects(() => client.browseProducts({ category_id: dogFoodId }), { code: 'invalid_response' });
    assert.deepEqual(calls, [categoryFilterUrl]);
  }
});
