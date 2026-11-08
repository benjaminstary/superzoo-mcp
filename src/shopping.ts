import type { SuperzooClient } from './client.js';
import {
  productBatchInput, commonStoresInput,
  type ProductBatchInput, type CommonStoresInput, type RequestContext,
  type ComparisonResult, type CommonStoresResult,
} from './contracts.js';
import { SuperzooError, toToolError } from './errors.js';

type LookupResult<T> = { value: T; error: null } | { value: null; error: ReturnType<typeof toToolError> };

async function lookupProducts<T>(
  ids: string[], lookup: (product_id: string) => Promise<T>, context: RequestContext,
): Promise<LookupResult<T>[]> {
  const results: LookupResult<T>[] = new Array(ids.length);
  let next = 0;
  let cancelled = false;
  const checkCancellation = () => {
    if (cancelled || context.signal?.aborted) {
      throw new SuperzooError('cancelled', 'Superzoo request cancelled');
    }
  };
  checkCancellation();
  await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
    while (next < ids.length) {
      checkCancellation();
      const index = next++;
      try {
        const value = await lookup(ids[index]!);
        checkCancellation();
        results[index] = { value, error: null };
      } catch (error) {
        if (context.signal?.aborted || (error instanceof SuperzooError && error.code === 'cancelled')) {
          cancelled = true;
          throw new SuperzooError('cancelled', 'Superzoo request cancelled');
        }
        results[index] = { value: null, error: toToolError(error) };
      }
    }
  }));
  checkCancellation();
  return results;
}

export async function compareProducts(
  client: Pick<SuperzooClient, 'market' | 'getProduct'>,
  input: ProductBatchInput,
  context: RequestContext = {},
): Promise<ComparisonResult> {
  const { product_ids } = productBatchInput.parse(input);
  const results = await lookupProducts(product_ids,
    product_id => client.getProduct({ product_id }, context), context);
  return {
    market: client.market.country,
    checked_at: new Date().toISOString(),
    product_ids,
    complete: results.every(result => result.error === null),
    products: results.map((result, index) => result.error === null
      ? { product_id: product_ids[index]!, product: result.value, error: null }
      : { product_id: product_ids[index]!, product: null, error: result.error }),
  };
}

export async function findCommonStores(
  client: Pick<SuperzooClient, 'market' | 'getProductAvailability'>,
  input: CommonStoresInput,
  context: RequestContext = {},
): Promise<CommonStoresResult> {
  const { product_ids, city } = commonStoresInput.parse(input);
  const results = await lookupProducts(product_ids,
    product_id => client.getProductAvailability({ product_id, ...(city === undefined ? {} : { city }) }, context), context);
  const stores = new Map<string, CommonStoresResult['stores'][number]>();
  // Traverse input order so completion timing cannot change display metadata.
  for (const result of results) {
    if (result.error !== null) continue;
    for (const store of result.value.stores) {
      if (!stores.has(store.store_id)) {
        stores.set(store.store_id, {
          store_id: store.store_id, name: store.name, address: store.address, url: store.url,
          products: [], all_in_stock: false,
        });
      }
    }
  }
  for (const store of stores.values()) {
    store.products = results.map((result, index) => {
      const observation = result.value?.stores.find(candidate => candidate.store_id === store.store_id);
      return {
        product_id: product_ids[index]!,
        status: observation?.status ?? null,
        pickup_text: observation?.pickup_text ?? null,
        checked_at: observation ? result.value!.checked_at : null,
        error: result.error,
      };
    });
    store.all_in_stock = store.products.every(product => product.status === 'inStock');
  }
  return {
    market: client.market.country,
    checked_at: new Date().toISOString(),
    product_ids,
    complete: results.every(result => result.error === null),
    city_filter: city ?? null,
    products: results.map((result, index) => result.error === null
      ? { product_id: product_ids[index]!, checked_at: result.value.checked_at, error: null }
      : { product_id: product_ids[index]!, checked_at: null, error: result.error }),
    stores: [...stores.values()],
  };
}
