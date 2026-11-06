import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SuperzooClient } from '../dist/client.js';
import { readConfig } from '../dist/config.js';

const detail = JSON.parse(readFileSync(new URL('./fixtures/product-detail.json', import.meta.url)));
const stores = JSON.parse(readFileSync(new URL('./fixtures/store-availability.json', import.meta.url)));
const response = data => new Response(JSON.stringify(data));

for (const [country, domain, language, currency, level] of [
  ['SK', 'https://www.superzoo.sk', 'sk', 'EUR', '22'],
  ['CZ', 'https://www.superzoo.cz', 'cs', 'CZK', '1'],
  ['PL', 'https://superzoo.com.pl', 'pl', 'PLN', null],
]) {
  test(`${country} keeps search, details, currency and store links in the selected market`, async () => {
    const client = new SuperzooClient({ country, fetchImpl: async (url, options) => {
      url = new URL(url);
      if (url.hostname === 'full-text-search.superzoo.cz') {
        assert.equal(url.pathname, `/search/api/mutations/superzoo_${country.toLowerCase()}/languages/${language}/search`);
        assert.equal(url.searchParams.get('f_must_not[1]'), level ? `disallowedPriceLevels:${level}` : null);
        return response({ totalCount: 2, items: [
          { id: '294-101115', type: 'productCatalogue.product', title: 'Oil', alias: 'oil', attributes: { disallowedPriceLevels: [] } },
          { id: 'blocked', type: 'productCatalogue.product', title: 'Blocked', alias: 'blocked', attributes: { disallowedPriceLevels: [level ?? '999'] } },
        ] });
      }
      assert.equal(url.origin, domain);
      if (url.pathname.endsWith('/availability')) {
        assert.equal(options.method, 'POST');
        return response(stores);
      }
      return response({ ...detail, price: { ...detail.price, variant: 'familyPrice' } });
    } });
    const result = await client.searchProducts({ query: 'oil', limit: 2 });
    assert.equal(result.market, country);
    assert.equal(result.products.length, 1);
    assert.equal(result.products[0].price.currency, currency);
    assert.equal(result.products[0].price.variant, 'familyPrice');
    assert.equal(new URL(result.products[0].url).origin, domain);
    const stock = await client.getProductAvailability({ product_id: '294-101115' });
    assert.equal(stock.market, country);
    assert.equal(new URL(stock.stores[0].url).origin, domain);
  });
}

test('configuration has portable defaults and validates countries, transports and ports', () => {
  const config = readConfig({});
  assert.equal(config.country, 'SK');
  assert.equal(config.transport, 'stdio');
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 3000);
  const custom = readConfig({ SUPERZOO_COUNTRY: 'cz', SUPERZOO_TRANSPORT: 'http', SUPERZOO_HOST: '0.0.0.0', SUPERZOO_PORT: '4000',
    SUPERZOO_ALLOWED_HOSTS: 'mcp.example.com, localhost', SUPERZOO_ALLOWED_ORIGINS: 'https://client.example.com' });
  assert.equal(custom.country, 'CZ');
  assert.deepEqual(custom.allowedHosts, ['mcp.example.com', 'localhost']);
  assert.deepEqual(custom.allowedOrigins, ['https://client.example.com']);
  for (const env of [{ SUPERZOO_COUNTRY: 'ZZ' }, { SUPERZOO_TRANSPORT: 'sse' }, { SUPERZOO_PORT: '3x' }, { SUPERZOO_PORT: '0' },
    { SUPERZOO_PORT: '65536' }, { SUPERZOO_ALLOWED_ORIGINS: '*' }, { SUPERZOO_ALLOWED_HOSTS: '*' },
    { SUPERZOO_HOST: 'https://example.com' }]) assert.throws(() => readConfig(env));
  assert.throws(() => new SuperzooClient({ country: 'ZZ' }));
});
