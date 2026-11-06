import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { SuperzooClient } from '../dist/client.js';
import {
  productResultSchema, availabilityResultSchema, searchResultSchema,
  productBatchInput, commonStoresInput, comparisonResultSchema, commonStoresResultSchema,
} from '../dist/contracts.js';
import { SuperzooError, toToolError } from '../dist/errors.js';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));
const detail = fixture('product-detail');
const stock = fixture('store-availability');
const response = data => new Response(JSON.stringify(data));
const productId = '294-101115';
const checkedAt = '2026-11-06T10:00:00.000Z';
const failure = { code: 'upstream_unavailable', message: 'Upstream unavailable', retryable: true };
const client = new SuperzooClient({ fetchImpl: async url => response(
  String(url).endsWith('/availability') ? stock : detail,
) });

// Rejecting existing payloads, dropping opaque upstream fields, or coercing prices breaks compatibility.
test('product schema preserves actual client payloads and conditional decimal prices in every market', async () => {
  for (const country of ['SK', 'CZ', 'PL']) {
    const marketClient = new SuperzooClient({ country, fetchImpl: async () => response({
      ...detail, price: { ...detail.price, sellPrice: '0.10', variant: 'familyPrice',
        salePercentage: '5', voucherCampaign: { label: 'conditional' } },
    }) });
    const result = await marketClient.getProduct({ product_id: productId });
    assert.deepEqual(productResultSchema.parse(result), result);
    assert.equal(result.price.amount, '0.10');
    assert.equal(result.price.variant, 'familyPrice');
  }
});

test('product schema accepts absent prices, optional upstream availability fields, and empty variants', async () => {
  for (const price of [null, {}, undefined]) {
    const sparse = new SuperzooClient({ fetchImpl: async () => response({
      product: detail.product, price, availability: { storeAvailability: {} },
    }) });
    const result = await sparse.getProduct({ product_id: productId });
    assert.deepEqual(productResultSchema.parse(result), result);
  }
  const result = await client.getProduct({ product_id: productId });
  assert.equal(productResultSchema.safeParse({ ...result, price: { ...result.price, amount: 13.99 } }).success, false);
  assert.equal(productResultSchema.safeParse({ ...result, checked_at: 'yesterday' }).success, false);
});

test('availability schema preserves unknown statuses, no quantities, and empty store results', async () => {
  const sparse = new SuperzooClient({ fetchImpl: async () => response({ items: [
    { ...stock.items[0], availability: {} },
    { ...stock.items[1], availability: { status: 'newUpstreamStatus' } },
  ] }) });
  const result = await sparse.getProductAvailability({ product_id: productId });
  assert.deepEqual(availabilityResultSchema.parse(result), result);
  assert.equal(result.stores[0].status, 'unknown');
  assert.equal(result.stores[1].status, 'newUpstreamStatus');
  assert.equal(availabilityResultSchema.safeParse({ ...result, stores: [{ ...result.stores[0], quantity: 4 }] }).success, false);
  const empty = await sparse.getProductAvailability({ product_id: productId, city: 'none' });
  assert.deepEqual(availabilityResultSchema.parse(empty), empty);
});

test('search schema accepts enriched, partial and empty client results without requiring future metadata', async () => {
  for (const failDetail of [false, true]) {
    const searchClient = new SuperzooClient({ fetchImpl: async url => {
      if (String(url).includes('full-text-search')) return response({ totalCount: 2, items: [
        { id: productId, title: 'Oil', alias: 'oil', type: 'productCatalogue.product' },
      ] });
      return failDetail ? new Response('', { status: 503 }) : response(detail);
    } });
    const result = await searchClient.searchProducts({ query: 'oil' });
    assert.deepEqual(searchResultSchema.parse(result), result);
    assert.deepEqual(searchResultSchema.parse({ ...result, products: [] }).products, []);
    const filtered = { ...result, filters_applied: { brand: 'Brit Care', min_price: '0.10', max_price: '10.00' },
      products_checked: 2, coverage: 'bounded_candidates' };
    assert.deepEqual(searchResultSchema.parse(filtered), filtered);
  }
});

test('batch inputs enforce one to ten unique variant IDs and existing city normalization', () => {
  for (const schema of [productBatchInput, commonStoresInput]) {
    assert.deepEqual(schema.parse({ product_ids: [productId] }).product_ids, [productId]);
    assert.equal(schema.parse({ product_ids: Array.from({ length: 10 }, (_, i) => `id-${i}`) }).product_ids.length, 10);
    for (const ids of [[], Array.from({ length: 11 }, (_, i) => `id-${i}`), [productId, productId], ['../users'], ['']]) {
      assert.equal(schema.safeParse({ product_ids: ids }).success, false);
    }
  }
  assert.equal(commonStoresInput.parse({ product_ids: [productId], city: ' Žilina ' }).city, 'Žilina');
  assert.equal(commonStoresInput.safeParse({ product_ids: [productId], city: ' ' }).success, false);
});

test('comparison schema freezes ordered successes and explicit per-product failures with original timestamps', async () => {
  const product = await client.getProduct({ product_id: productId });
  const result = { market: 'SK', checked_at: checkedAt, product_ids: [productId, 'missing'], complete: false,
    products: [ { product_id: productId, product, error: null }, { product_id: 'missing', product: null, error: failure } ] };
  assert.deepEqual(comparisonResultSchema.parse(result), result);
  const success = { ...result, product_ids: [productId], complete: true, products: [result.products[0]] };
  assert.deepEqual(comparisonResultSchema.parse(success), success);
  assert.equal(comparisonResultSchema.safeParse({ ...result, products: [{ product_id: productId, product: null }] }).success, false);
});

test('common-store schema represents missing observations, failures and no-store results without inventing stock', () => {
  const result = { market: 'SK', checked_at: checkedAt, product_ids: [productId, 'missing'], city_filter: null, complete: false,
    products: [ { product_id: productId, checked_at: checkedAt, error: null }, { product_id: 'missing', checked_at: null, error: failure } ],
    stores: [{ store_id: 'SKPIC-450', name: 'Skalica', address: 'Skalica', url: 'https://www.superzoo.sk/skalica/',
      all_in_stock: false, products: [
        { product_id: productId, status: 'inStock', pickup_text: 'tomorrow', checked_at: checkedAt, error: null },
        { product_id: 'missing', status: null, pickup_text: null, checked_at: null, error: failure },
      ] }],
  };
  assert.deepEqual(commonStoresResultSchema.parse(result), result);
  assert.deepEqual(commonStoresResultSchema.parse({ ...result, stores: [] }).stores, []);
  const missingObservation = { product_id: 'missing', status: null, pickup_text: null, checked_at: null, error: null };
  assert.deepEqual(commonStoresResultSchema.parse({ ...result, stores: [{ ...result.stores[0],
    products: [result.stores[0].products[0], missingObservation] }] }).stores[0].products[1], missingObservation);
});

test('all success contracts can be published as JSON schemas', () => {
  for (const schema of [productResultSchema, availabilityResultSchema, searchResultSchema, comparisonResultSchema, commonStoresResultSchema]) {
    const json = z.toJSONSchema(schema);
    assert.equal(json.type, 'object');
    assert.ok(json.properties);
  }
});

test('typed errors retain stable codes and retryability; unexpected errors stay internal and redact details', () => {
  for (const code of ['not_found', 'rate_limited', 'upstream_unavailable', 'invalid_response', 'timeout', 'cancelled', 'overloaded', 'internal_error']) {
    const error = new SuperzooError(code, 'Readable error', true);
    assert.ok(error instanceof Error);
    assert.deepEqual(toToolError(error), { code, message: 'Readable error', retryable: true });
  }
  assert.equal(toToolError(new SuperzooError('not_found', 'Missing')).retryable, false);
  for (const error of [new Error('secret headers'), 'secret body', null, {}]) {
    assert.deepEqual(toToolError(error), { code: 'internal_error', message: 'Superzoo request failed', retryable: false });
  }
});
