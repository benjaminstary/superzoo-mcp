import { z } from 'zod';
import { getMarket } from './config.js';
import type { Market } from './config.js';
import type { RequestContext, ProductResult, AvailabilityResult, SearchResult } from './contracts.js';
import { createRequestPolicy } from './request.js';
import { SuperzooError } from './errors.js';

const SEARCH = 'https://full-text-search.superzoo.cz/search/api';
const CANDIDATE_LIMIT = 200;
const idSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/);
export const productInput = z.object({ product_id: idSchema });
export const searchInput = z.object({
  query: z.string().trim().min(1).max(200),
  limit: z.number().int().min(1).max(50).default(10),
});
export const availabilityInput = productInput.extend({ city: z.string().trim().min(1).max(100).optional() });
const nullableText = z.string().nullable().optional();
const decimal = z.string().regex(/^\d+(?:\.\d+)?$/).nullable().optional();
const priceSchema = z.object({
  sellPrice: decimal, originalPrice: decimal, calculatedLowestPrice: decimal, variant: nullableText,
}).passthrough().nullable().optional();
const detailSchema = z.object({
  product: z.object({ id: idSchema, name: z.string().min(1), alias: z.string().min(1),
    ean: nullableText, catalogueNumber: nullableText, canBuy: z.boolean().optional(),
    brand: z.object({ name: z.string() }).passthrough().nullable().optional(),
  }).passthrough(),
  price: priceSchema,
  variants: z.array(z.object({
    variantName: z.string(),
    variants: z.array(z.object({ id: idSchema, name: z.string(), alias: z.string(),
      isActive: z.boolean(), isDisabled: z.boolean() })),
  }).passthrough()).optional(),
  availability: z.object({
    availableStoresCount: z.number().int().nonnegative().nullable().optional(),
    storeAvailability: z.object({ text: nullableText, availability: nullableText }).nullable().optional(),
    deliveryAvailability: z.object({ text: nullableText, availability: nullableText }).nullable().optional(),
    isFreeDelivery: z.boolean().optional(),
  }).passthrough().nullable().optional(),
});
const searchSchema = z.object({
  totalCount: z.number().int().nonnegative(),
  items: z.array(z.object({
    id: z.string(), type: z.string(), title: z.string(), alias: z.string().optional(),
    annotation: nullableText,
    attributes: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]).optional(),
  })),
});
const storesSchema = z.object({ items: z.array(z.object({
  id: z.string(), name: z.string(), address: z.string(), alias: z.string(), openingHours: nullableText,
  availability: z.object({ status: nullableText, text: nullableText }).nullable().optional(),
})) });
const link = (market: Market, alias: string) => `${market.web}/${encodeURIComponent(alias)}/`;
const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const context = (market: Market, source: string, checked_at: string) => ({ source, market: market.country, checked_at });
const publicPrice = (market: Market, price: z.output<typeof priceSchema>) => price ? {
  amount: price.sellPrice ?? null,
  currency: market.currency, context: 'public_online' as const, variant: price.variant ?? null,
  original_amount: price.originalPrice ?? null,
  lowest_amount: price.calculatedLowestPrice ?? null,
  sale_percentage: price.salePercentage ?? null,
  voucher_campaign: price.voucherCampaign ?? null,
} : null;

interface ClientOptions {
  country?: string;
  fetchImpl?: typeof globalThis.fetch;
  timeoutMs?: number;
}

type SearchCandidate = z.output<typeof searchSchema>['items'][number] & { alias: string };
type SearchProduct = (ProductResult & { description: string | null }) | {
  product_id: string; name: string; description: string | null; url: string;
  price: null; availability: null; detail_error: string;
};

export class SuperzooClient {
  readonly market: Market;
  private readonly policy: ReturnType<typeof createRequestPolicy>;
  constructor({ country = 'SK', fetchImpl = globalThis.fetch, timeoutMs = 15_000 }: ClientOptions = {}) {
    this.market = getMarket(country);
    this.policy = createRequestPolicy({ fetchImpl, timeoutMs });
  }

  async getProduct(input: z.input<typeof productInput>, requestContext: RequestContext = {}): Promise<ProductResult> {
    const { product_id } = productInput.parse(input);
    const source = `${this.market.web}/web-api/products/${product_id}`;
    const { data, checked_at } = await this.policy.request({
      market: this.market.country, operation: 'product', productId: product_id, url: source,
      schema: detailSchema.refine(data => data.product.id === product_id), ...requestContext,
    });
    return {
      ...context(this.market, source, checked_at), product_id: data.product.id, name: data.product.name,
      url: link(this.market, data.product.alias), ean: data.product.ean ?? null,
      catalogue_number: data.product.catalogueNumber ?? null,
      brand: data.product.brand?.name ?? null, can_buy: data.product.canBuy ?? null,
      price: publicPrice(this.market, data.price), variants: data.variants ?? [],
      availability: data.availability ?? null,
    };
  }

  async searchProducts(input: z.input<typeof searchInput>, requestContext: RequestContext = {}): Promise<SearchResult> {
    const { query, limit } = searchInput.parse(input);
    const url = new URL(`${SEARCH}/mutations/superzoo_${this.market.country.toLowerCase()}/languages/${this.market.language}/search`);
    url.search = new URLSearchParams({
      term: query, 'types[0]': 'productCatalogue.product', limit: String(CANDIDATE_LIMIT),
      'f_must_not[0]': 'productSaleForbidden:true',
      ...(this.market.priceLevel ? { 'f_must_not[1]': `disallowedPriceLevels:${this.market.priceLevel}` } : {}),
    }).toString();
    const { data, checked_at } = await this.policy.request({
      market: this.market.country, operation: 'search', url, schema: searchSchema, ...requestContext,
    });
    const seen = new Set();
    const candidates = data.items.filter((item): item is SearchCandidate => {
      if (item.type !== 'productCatalogue.product' || !idSchema.safeParse(item.id).success || !item.alias) return false;
      const attrs = Array.isArray(item.attributes) ? {} : item.attributes ?? {};
      // Unexpected restriction encodings fail closed rather than exposing a forbidden product.
      const forbidden = attrs.productSaleForbidden;
      if (forbidden !== undefined && forbidden !== false &&
          !(Array.isArray(forbidden) && forbidden.length > 0 && forbidden.every(value => value === 'false' || value === false))) return false;
      const levels = attrs.disallowedPriceLevels;
      if (levels != null && (!Array.isArray(levels) || (this.market.priceLevel ? levels.some(level => String(level) === this.market.priceLevel) : levels.length > 0))) return false;
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    }).slice(0, limit);
    const products: SearchProduct[] = new Array(candidates.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, async () => {
      while (next < candidates.length) {
        if (requestContext.signal?.aborted) throw new SuperzooError('cancelled', 'Superzoo request cancelled');
        const index = next++;
        const item = candidates[index]!;
        const base = { product_id: item.id, name: item.title, description: item.annotation ?? null,
          url: link(this.market, item.alias), price: null, availability: null };
        try { products[index] = { ...base, ...await this.getProduct({ product_id: item.id }, requestContext) }; }
        catch (error) {
          if (requestContext.signal?.aborted || (error instanceof SuperzooError && error.code === 'cancelled')) {
            throw new SuperzooError('cancelled', 'Superzoo request cancelled');
          }
          products[index] = { ...base, detail_error: error instanceof Error ? error.message : 'Superzoo request failed' };
        }
      }
    }));
    if (requestContext.signal?.aborted) throw new SuperzooError('cancelled', 'Superzoo request cancelled');
    return {
      ...context(this.market, url.toString(), checked_at), query, products,
      upstream_total_count: data.totalCount, total_count_is_product_count: false,
      candidates_checked: data.items.length,
      candidate_limit_reached: data.totalCount > data.items.length,
      requested_limit_filled: products.length === limit,
    };
  }

  async getProductAvailability(input: z.input<typeof availabilityInput>, requestContext: RequestContext = {}): Promise<AvailabilityResult> {
    const { product_id, city } = availabilityInput.parse(input);
    const source = `${this.market.web}/web-api/products/${product_id}/availability`;
    const { data, checked_at } = await this.policy.request({
      market: this.market.country, operation: 'availability', productId: product_id, url: source, schema: storesSchema,
      init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, ...requestContext,
    });
    const stores = data.items.filter(store => !city || fold(`${store.name} ${store.address}`).includes(fold(city)))
      .map(store => ({
        store_id: store.id, name: store.name, address: store.address,
        url: link(this.market, store.alias),
        opening_hours_html: store.openingHours ?? null,
        status: store.availability?.status ?? 'unknown',
        pickup_text: store.availability?.text ?? null, quantity: null,
      }));
    return { ...context(this.market, source, checked_at), product_id, city_filter: city ?? null,
      total_stores: data.items.length, stores };
  }
}
