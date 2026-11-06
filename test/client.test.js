import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SuperzooClient } from '../dist/client.js';

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
