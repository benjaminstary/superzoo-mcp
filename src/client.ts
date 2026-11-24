import { z } from 'zod';
import { getMarket } from './config.js';
import type { Market } from './config.js';
import type { RequestContext, ProductResult, AvailabilityResult, FindStoresResult, SearchResult, DeliveryOptionsResult,
  ListProductCategoriesResult, BrowseProductsResult } from './contracts.js';
import { createRequestPolicy } from './request.js';
import { SuperzooError } from './errors.js';

const SEARCH = 'https://full-text-search.superzoo.cz/search/api';
const DELIVERY_QUOTE = 'https://logistics.superzoo.cz/api/actions/calculate-product-shipping-options';
const CANDIDATE_LIMIT = 200;
const CATEGORY_PAGE_SIZE = 10;
const DOG_FOOD = {
  id: '42eeee01-5544-4e68-8130-bef9755298ae',
  scopeId: 'c1955f56-7438-4c93-8875-9dc8f634acd9',
  markets: {
    CZ: { webId: 'superzoo_cz', name: 'Granule pro psy', facet: 'stari-psa', ages: ['dospely', 'senior', 'stene'] },
    SK: { webId: 'superzoo_sk', name: 'Granuly pre psov', facet: 'vek-psa', ages: ['dospely', 'senior', 'stena'] },
  },
} as const;
const idSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/);
const decimalText = z.string().regex(/^\d+(?:\.\d+)?$/);

function compareDecimals(left: string, right: string): number {
  const [leftWhole = '', leftFraction = ''] = left.split('.');
  const [rightWhole = '', rightFraction = ''] = right.split('.');
  const a = leftWhole.replace(/^0+/, '');
  const b = rightWhole.replace(/^0+/, '');
  if (a.length !== b.length) return a.length - b.length;
  if (a !== b) return a < b ? -1 : 1;
  const width = Math.max(leftFraction.length, rightFraction.length);
  const x = leftFraction.padEnd(width, '0');
  const y = rightFraction.padEnd(width, '0');
  return x === y ? 0 : x < y ? -1 : 1;
}

export const productInput = z.object({ product_id: idSchema });
export const deliveryQuantitySchema = z.number().int().min(1).max(2);
export const deliveryOptionsInput = z.strictObject({
  ...productInput.shape,
  quantity: deliveryQuantitySchema.default(1),
});
export const searchInput = z.object({
  query: z.string().trim().min(1).max(200),
  limit: z.number().int().min(1).max(50).default(10),
  brand: z.string().trim().min(1).max(100).optional()
    .describe('Exact brand name, ignoring case and accents.'),
  min_price: decimalText.optional()
    .describe('Inclusive minimum public offer price. Conditional offers retain their eligibility labels.'),
  max_price: decimalText.optional()
    .describe('Inclusive maximum public offer price. Conditional offers retain their eligibility labels.'),
  online_only: z.boolean().optional()
    .describe('Include only explicit delivery availability; unknown status is omitted. No address or timing guarantee.'),
}).refine(input => input.min_price === undefined || input.max_price === undefined ||
  compareDecimals(input.min_price, input.max_price) <= 0, {
  path: ['max_price'], message: 'Maximum price must be at least the minimum price',
});
export const availabilityInput = productInput.extend({ city: z.string().trim().min(1).max(100).optional() });
export const findStoresInput = z.strictObject({
  latitude: z.number().min(-90).max(90).describe('Latitude in decimal degrees.'),
  longitude: z.number().min(-180).max(180).describe('Longitude in decimal degrees.'),
});
export const listProductCategoriesInput = z.strictObject({});
const browseCategoryInput = z.strictObject({
  category_id: z.literal(DOG_FOOD.id).describe('Category ID from list_product_categories.'),
  page: z.number().int().positive().default(1).describe('One-based page number. Use next_page with the same category and facets to continue.'),
});
export const browseProductsInputs = {
  CZ: browseCategoryInput.extend({
    facets: z.strictObject({ [DOG_FOOD.markets.CZ.facet]: z.enum(DOG_FOOD.markets.CZ.ages).optional() }).optional(),
  }),
  SK: browseCategoryInput.extend({
    facets: z.strictObject({ [DOG_FOOD.markets.SK.facet]: z.enum(DOG_FOOD.markets.SK.ages).optional() }).optional(),
  }),
};
type BrowseProductsInput = z.input<(typeof browseProductsInputs)[keyof typeof browseProductsInputs]>;
const nullableText = z.string().nullable().optional();
const decimal = decimalText.nullable().optional();
const nonBlankText = z.string().regex(/\S/);
const categoryPageSchema = z.object({
  products: z.array(z.object({ id: idSchema })).max(CATEGORY_PAGE_SIZE),
  totalCount: z.number().int().nonnegative(),
}).refine(({ products, totalCount }) =>
  products.length <= totalCount && new Set(products.map(product => product.id)).size === products.length);
const categoryProductsSchema = z.object({
  items: z.array(z.object({
    product: z.object({
      productId: idSchema, name: nonBlankText, alias: nonBlankText,
      published: z.boolean(), productSaleForbidden: z.boolean(), disallowedPriceLevels: z.array(z.string()),
    }),
    prices: z.array(z.object({ productId: idSchema, webId: nonBlankText, priceLevelId: nonBlankText })),
  })).max(CATEGORY_PAGE_SIZE),
});
const ratingSchema = z.object({
  rating: z.number().nonnegative(),
  ratingCount: z.number().int().nonnegative(),
}).nullable().catch(null).optional();
const parameterSchema = z.object({
  name: nonBlankText,
  value: nonBlankText,
}).nullable().catch(null);
const unitPriceSchema = z.object({
  unitPrice: decimalText,
  unitSize: z.string().regex(/^(?=.*[1-9])\d+(?:\.\d+)?$/),
  unit: nonBlankText,
}).nullable().catch(null).optional();
const priceSchema = z.object({
  sellPrice: decimal, originalPrice: decimal, calculatedLowestPrice: decimal, variant: nullableText,
  sellUnitPrice: unitPriceSchema, originalUnitPrice: unitPriceSchema,
}).passthrough().nullable().optional();
const detailSchema = z.object({
  product: z.object({ id: idSchema, name: z.string().min(1), alias: z.string().min(1),
    ean: nullableText, catalogueNumber: nullableText, canBuy: z.boolean().optional(),
    brand: z.object({ name: z.string() }).passthrough().nullable().optional(),
  }).passthrough(),
  price: priceSchema,
  rating: ratingSchema,
  parameters: z.array(parameterSchema).catch([]).optional(),
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
const nearestStoreSchema = z.object({
  nearestStore: z.object({
    id: nonBlankText, name: nonBlankText, address: nonBlankText,
    latitude: findStoresInput.shape.latitude.nullable().catch(null).optional(),
    longitude: findStoresInput.shape.longitude.nullable().catch(null).optional(),
  }).nullable(),
});
const quotePrice = z.object({
  amountIncVat: decimalText,
  currency: z.enum(['EUR', 'CZK']),
}).nullish().catch(null);
const quoteDate = z.iso.datetime({ offset: true }).nullish().catch(null);
const quoteFlag = z.boolean().nullish().catch(null);
const quoteMethod = {
  name: nonBlankText,
  price: quotePrice,
  deliveryDate: quoteDate,
};
const quotedItems = z.tuple([z.object({ productId: idSchema, quantity: deliveryQuantitySchema })]);
const deliveryQuoteSchema = z.object({
  shippingOptions: z.object({
    shipment: z.object({ items: quotedItems }),
    items: quotedItems.optional(),
    deliveryMethods: z.array(z.object({
      ...quoteMethod,
      deliveryMethodId: nonBlankText,
      isPriceFrom: quoteFlag,
    })),
    personalPickups: z.array(z.object({
      ...quoteMethod,
      personalPickupId: nonBlankText,
      isStore: quoteFlag,
      places: z.array(z.object({
        pickupPlaceId: nonBlankText,
        personalPickupId: nonBlankText,
        name: nonBlankText,
        isAvailable: quoteFlag,
        deliveryDate: quoteDate,
        extraFee: quotePrice,
      })),
    }).refine(method => method.places.every(place => place.personalPickupId === method.personalPickupId))),
  }),
});
const link = (market: Market, alias: string) => `${market.web}/${encodeURIComponent(alias)}/`;
const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export function matchesStoreCity(store: { name: string; address: string }, city: string): boolean {
  return fold(`${store.name} ${store.address}`).includes(fold(city));
}

const context = (market: Market, source: string, checked_at: string) => ({ source, market: market.country, checked_at });
const publicQuotePrice = (market: Market, price: z.output<typeof quotePrice>) =>
  price && price.currency === market.currency ? { amount: price.amountIncVat, currency: price.currency } : null;
const publicUnitPrice = (price: z.output<typeof unitPriceSchema>) => price ? {
  amount: price.unitPrice,
  unit_size: price.unitSize,
  unit: price.unit,
} : null;
const publicPrice = (market: Market, price: z.output<typeof priceSchema>) => price ? {
  amount: price.sellPrice ?? null,
  currency: market.currency, context: 'public_online' as const, variant: price.variant ?? null,
  original_amount: price.originalPrice ?? null,
  lowest_amount: price.calculatedLowestPrice ?? null,
  unit_price: publicUnitPrice(price.sellUnitPrice),
  original_unit_price: publicUnitPrice(price.originalUnitPrice),
  sale_percentage: price.salePercentage ?? null,
  voucher_campaign: price.voucherCampaign ?? null,
} : null;

interface ClientOptions {
  country?: string;
  fetchImpl?: typeof globalThis.fetch;
  timeoutMs?: number;
  signal?: AbortSignal;
  logRequests?: boolean;
}

type SearchCandidate = z.output<typeof searchSchema>['items'][number] & { alias: string };
type SearchProduct = (ProductResult & { description: string | null }) | {
  product_id: string; name: string; description: string | null; url: string;
  price: null; availability: null; detail_error: string;
};

export class SuperzooClient {
  readonly market: Market;
  private readonly policy: ReturnType<typeof createRequestPolicy>;
  constructor({ country = 'SK', fetchImpl = globalThis.fetch, timeoutMs = 15_000, signal, logRequests = true }: ClientOptions = {}) {
    this.market = getMarket(country);
    this.policy = createRequestPolicy({ fetchImpl, timeoutMs, logRequests, ...(signal === undefined ? {} : { signal }) });
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
      rating: data.rating ? { value: data.rating.rating, count: data.rating.ratingCount } : null,
      attributes: (data.parameters ?? []).filter(parameter => parameter !== null),
      price: publicPrice(this.market, data.price), variants: data.variants ?? [],
      availability: data.availability ?? null,
    };
  }

  async searchProducts(input: z.input<typeof searchInput>, requestContext: RequestContext = {}): Promise<SearchResult> {
    const { query, limit, brand, min_price, max_price, online_only } = searchInput.parse(input);
    const filters = {
      ...(brand === undefined ? {} : { brand }),
      ...(min_price === undefined ? {} : { min_price }),
      ...(max_price === undefined ? {} : { max_price }),
      ...(online_only === undefined ? {} : { online_only }),
    };
    const requiresDetails = brand !== undefined || min_price !== undefined || max_price !== undefined || online_only === true;
    const matches = (product: ProductResult): boolean => {
      if (brand !== undefined && (product.brand === null || fold(product.brand) !== fold(brand))) return false;
      if (min_price !== undefined || max_price !== undefined) {
        const amount = product.price?.amount;
        if (amount == null) return false;
        if (min_price !== undefined && compareDecimals(amount, min_price) < 0) return false;
        if (max_price !== undefined && compareDecimals(amount, max_price) > 0) return false;
      }
      // Only this delivery code is verified; branch stock and canBuy are separate facts.
      return online_only !== true || product.availability?.deliveryAvailability?.availability === 'available';
    };
    const url = new URL(`${SEARCH}/mutations/superzoo_${this.market.country.toLowerCase()}/languages/${this.market.language}/search`);
    url.search = new URLSearchParams({
      term: query, 'types[0]': 'productCatalogue.product', limit: String(CANDIDATE_LIMIT),
      'f_must_not[0]': 'productSaleForbidden:true',
      ...(this.market.priceLevel ? { 'f_must_not[1]': `disallowedPriceLevels:${this.market.priceLevel}` } : {}),
    }).toString();
    const { data, checked_at } = await this.policy.request({
      market: this.market.country, operation: 'search', url, schema: searchSchema, ...requestContext,
    });
    const items = data.items.slice(0, CANDIDATE_LIMIT);
    const seen = new Set();
    const candidates = items.filter((item): item is SearchCandidate => {
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
    });
    const products: SearchProduct[] = [];
    let productsChecked = 0;
    let detailFailures = 0;
    while (productsChecked < candidates.length && products.length < limit) {
      const window = candidates.slice(productsChecked, productsChecked + Math.min(4, limit - products.length));
      const enriched = await Promise.all(window.map(async (item): Promise<SearchProduct | null> => {
        if (requestContext.signal?.aborted) throw new SuperzooError('cancelled', 'Superzoo request cancelled');
        productsChecked++;
        const base = { product_id: item.id, name: item.title, description: item.annotation ?? null,
          url: link(this.market, item.alias), price: null, availability: null };
        try {
          const product = await this.getProduct({ product_id: item.id }, requestContext);
          return matches(product) ? { ...base, ...product } : null;
        }
        catch (error) {
          if (requestContext.signal?.aborted || (error instanceof SuperzooError && error.code === 'cancelled')) {
            throw new SuperzooError('cancelled', 'Superzoo request cancelled');
          }
          detailFailures++;
          return requiresDetails ? null : { ...base, detail_error: error instanceof Error ? error.message : 'Superzoo request failed' };
        }
      }));
      products.push(...enriched.filter((product): product is SearchProduct => product !== null));
    }
    if (requestContext.signal?.aborted) throw new SuperzooError('cancelled', 'Superzoo request cancelled');
    return {
      ...context(this.market, url.toString(), checked_at), query, products,
      upstream_total_count: data.totalCount, total_count_is_product_count: false,
      candidates_checked: items.length,
      candidate_limit_reached: data.totalCount > items.length || data.items.length > items.length,
      requested_limit_filled: products.length === limit,
      filters_applied: filters,
      products_checked: productsChecked,
      detail_failures: detailFailures,
      coverage: 'bounded_candidates',
    };
  }

  async listProductCategories(input: z.input<typeof listProductCategoriesInput>): Promise<ListProductCategoriesResult> {
    listProductCategoriesInput.parse(input);
    if (this.market.country === 'PL') {
      throw new SuperzooError('not_found', `Category browsing is not supported in ${this.market.name}`);
    }
    const category = DOG_FOOD.markets[this.market.country];
    return {
      market: this.market.country,
      categories: [{
        category_id: DOG_FOOD.id, name: category.name,
        facets: [{ key: category.facet, values: [...category.ages] }],
      }],
    };
  }

  async browseProducts(input: BrowseProductsInput, requestContext: RequestContext = {}): Promise<BrowseProductsResult> {
    const market = this.market;
    if (market.country === 'PL') {
      throw new SuperzooError('not_found', `Category browsing is not supported in ${market.name}`);
    }
    const { category_id, facets = {}, page } = browseProductsInputs[market.country].parse(input);
    const { webId, facet } = DOG_FOOD.markets[market.country];
    const priceLevel = market.priceLevel;
    const source = `https://parameter-filter.superzoo.cz/filter-products/${webId}`;
    const [age] = Object.values(facets);
    const query = age === undefined ? {} : { parameters: [{ alias: facet, values: [age] }] };
    const post = { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' } } as const;
    const { data: filtered, checked_at } = await this.policy.request({
      market: market.country, operation: 'category_filter', url: source, schema: categoryPageSchema,
      init: { ...post, body: JSON.stringify({
        priceLevel, scope: { category: DOG_FOOD.scopeId },
        filters: { onlyOnSale: true, onlyInStock: false, promotedOnly: false },
        facets: ['brands', 'parameters', 'campaigns', 'categories', 'reviews', 'prices'],
        query, paging: { page, limit: CATEGORY_PAGE_SIZE },
      }) },
      ...requestContext,
    });
    const ids = filtered.products.map(product => product.id);
    const result = {
      market: market.country, source, checked_at, category_id,
      facets_applied: age === undefined ? {} : facets, coverage: page === 1 ? 'first_page' : 'category_page',
      page, next_page: page < Math.ceil(filtered.totalCount / CATEGORY_PAGE_SIZE) ? page + 1 : null,
      upstream_total_count: filtered.totalCount, candidates_checked: ids.length,
    } satisfies Omit<BrowseProductsResult, 'product_source' | 'eligible_count' | 'products'>;
    if (ids.length === 0) return { ...result, product_source: null, eligible_count: 0, products: [] };

    const product_source = `https://read-model.superzoo.cz/collections/product/webs/${webId}/languages/${market.language}/documents/filter`;
    const { data: records } = await this.policy.request({
      market: market.country, operation: 'category_products', url: product_source, schema: categoryProductsSchema,
      init: { ...post, body: JSON.stringify({ ids }) }, ...requestContext,
    });
    const byId = new Map(records.items.map(item => [item.product.productId, item]));
    if (records.items.length !== ids.length || ids.some(id => !byId.has(id))) {
      throw new SuperzooError('invalid_response', 'Superzoo category product records did not match the requested IDs');
    }
    const products = ids.flatMap(id => {
      const { product, prices } = byId.get(id)!;
      if (!product.published || product.productSaleForbidden || product.disallowedPriceLevels.includes(priceLevel) ||
          !prices.some(price => price.productId === id && price.webId === webId && price.priceLevelId === priceLevel)) return [];
      return [{ product_id: id, name: product.name, url: link(market, product.alias) }];
    });
    return { ...result, product_source, eligible_count: products.length, products };
  }

  async getProductAvailability(input: z.input<typeof availabilityInput>, requestContext: RequestContext = {}): Promise<AvailabilityResult> {
    const { product_id, city } = availabilityInput.parse(input);
    const source = `${this.market.web}/web-api/products/${product_id}/availability`;
    const { data, checked_at } = await this.policy.request({
      market: this.market.country, operation: 'availability', productId: product_id, url: source, schema: storesSchema,
      init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, ...requestContext,
    });
    const stores = data.items.filter(store => !city || matchesStoreCity(store, city))
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

  async findStores(input: z.input<typeof findStoresInput>, requestContext: RequestContext = {}): Promise<FindStoresResult> {
    const coordinates = findStoresInput.parse(input);
    const market = this.market;
    if (market.storeLocatorPath === null) {
      throw new SuperzooError('not_found', `Store locator is not supported in ${market.name}`);
    }
    const source = `${market.web}${market.storeLocatorPath}`;
    const { data, checked_at } = await this.policy.request({
      market: market.country, operation: 'store_locator', url: source, schema: nearestStoreSchema,
      init: { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(coordinates) },
      ...requestContext,
    });
    const store = data.nearestStore;
    return {
      source, market: market.country, checked_at, coverage: 'nearest_store',
      stores: store ? [{
        store_id: store.id, name: store.name, address: store.address,
        latitude: store.latitude ?? null, longitude: store.longitude ?? null,
      }] : [],
    };
  }

  async getDeliveryOptions(input: z.input<typeof deliveryOptionsInput>, requestContext: RequestContext = {}): Promise<DeliveryOptionsResult> {
    const { product_id, quantity } = deliveryOptionsInput.parse(input);
    const market = this.market;
    if (market.deliveryQuoteWebId === null) {
      throw new SuperzooError('not_found', `Delivery quotes are not supported in ${market.name}`);
    }
    const { data, checked_at } = await this.policy.request({
      market: market.country, operation: 'delivery_quote', url: DELIVERY_QUOTE,
      schema: deliveryQuoteSchema.refine(({ shippingOptions }) => {
        const [shipmentItem] = shippingOptions.shipment.items;
        const quoteItem = shippingOptions.items?.[0];
        return shipmentItem.productId === product_id && shipmentItem.quantity === quantity &&
          (quoteItem === undefined || (quoteItem.productId === product_id && quoteItem.quantity === quantity));
      }),
      init: { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webId: market.deliveryQuoteWebId, product: { productId: product_id, quantity } }) },
      ...requestContext,
    });
    const { deliveryMethods, personalPickups } = data.shippingOptions;
    return {
      market: market.country, source: DELIVERY_QUOTE, checked_at, product_id, quantity,
      delivery_methods: deliveryMethods.map(method => ({
        method_id: method.deliveryMethodId, name: method.name, price: publicQuotePrice(market, method.price),
        delivery_date: method.deliveryDate ?? null, is_price_from: method.isPriceFrom ?? null,
      })),
      pickup_methods: personalPickups.map(method => ({
        method_id: method.personalPickupId, name: method.name, price: publicQuotePrice(market, method.price),
        delivery_date: method.deliveryDate ?? null, is_store: method.isStore ?? null,
        places: method.places.map(place => ({
          place_id: place.pickupPlaceId, name: place.name, is_available: place.isAvailable ?? null,
          delivery_date: place.deliveryDate ?? null, extra_fee: publicQuotePrice(market, place.extraFee),
        })),
      })),
    };
  }
}
