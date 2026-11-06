import assert from 'node:assert/strict';
import { SuperzooClient } from '../dist/client.js';
import { readConfig } from '../dist/config.js';

const { country } = readConfig();
const client = new SuperzooClient({ country });
const search = await client.searchProducts({ query: 'brit care', limit: 1 });
assert.equal(search.products.length, 1);
assert.equal(search.market, country);
const product = search.products[0];
assert.ok(!product.detail_error, product.detail_error);
assert.equal(product.price?.currency, client.market.currency);
assert.ok(product.price.amount);
const stock = await client.getProductAvailability({ product_id: product.product_id });
assert.ok(stock.total_stores > 0);
console.log(JSON.stringify({
  country, product_id: product.product_id, name: product.name, price: product.price,
  checked_at: stock.checked_at, total_stores: stock.total_stores,
  sample_stores: stock.stores.slice(0, 3).map(({ name, status, pickup_text }) => ({ name, status, pickup_text })),
}, null, 2));
