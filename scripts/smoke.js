import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SuperzooClient } from '../dist/client.js';
import { getMarket, readConfig } from '../dist/config.js';
import { searchResultSchema, productResultSchema, availabilityResultSchema } from '../dist/contracts.js';
import { SuperzooError, toToolError } from '../dist/errors.js';

const invalidResponse = () => new SuperzooError('invalid_response', 'Smoke response validation failed');
// Observed raw codes are accepted for drift checks, without interpreting availability as inStock.
const stockStatuses = new Set(['inStock', 'available', 'notAvailable', 'unknown']);

function validate(schema, data, market) {
  const parsed = schema.safeParse(data);
  if (!parsed.success || data.market !== market.country) throw invalidResponse();
}

function validateProduct(product, market) {
  validate(productResultSchema, product, market);
  if (product.price !== null && product.price.currency !== market.currency) throw invalidResponse();
}

// The request policy owns retries and deadlines. This canary adds no extra retries.
export async function runSmoke({ country = 'SK', client, log = console.error, now = performance.now.bind(performance) } = {}) {
  const market = getMarket(country);
  client ??= new SuperzooClient({ country: market.country });
  let productId;
  const operations = [
    ['search', async () => {
      const search = await client.searchProducts({ query: 'brit care', limit: 1 });
      validate(searchResultSchema, search, market);
      if (search.products.length === 0) return 'empty_search';
      for (const product of search.products) validateProduct(product, market);
      productId = search.products[0].product_id;
    }],
    ['product', async () => {
      const product = await client.getProduct({ product_id: productId });
      validateProduct(product, market);
      if (product.product_id !== productId) throw invalidResponse();
    }],
    ['availability', async () => {
      const stock = await client.getProductAvailability({ product_id: productId });
      validate(availabilityResultSchema, stock, market);
      if (stock.product_id !== productId || stock.stores.some(store => !stockStatuses.has(store.status))) {
        throw invalidResponse();
      }
      if (stock.stores.length === 0) return 'empty_stock';
    }],
  ];
  for (const [operation, check] of operations) {
    const started = now();
    let code;
    try { code = await check(); }
    catch (error) { code = toToolError(error).code; }
    const record = { market: market.country, operation, result: code ? 'failed' : 'ok',
      duration_ms: Math.max(0, Math.round(now() - started)) };
    if (code) record.code = code;
    log(JSON.stringify(record));
    if (code) return false;
  }
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (!await runSmoke({ country: readConfig().country })) process.exitCode = 1;
  } catch {
    // Configuration failures must not echo environment values or arbitrary messages.
    console.error(JSON.stringify({ operation: 'configuration', result: 'failed', code: 'invalid_configuration', duration_ms: 0 }));
    process.exitCode = 1;
  }
}
