import { z } from 'zod';
import { browseProductsInput, catalogueId, catalogueKeyword, describeFilters, facetLabelsSchema,
  listProductCategoriesInput, navigationCategorySchema, navigationSchema, rawFacetsSchema, routeSchema,
  sortRequests, validateCatalogueSelection } from './categories.js';
import type { BrowseProductsInput, RawFacets } from './categories.js';
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
const idSchema = catalogueId;
const marketWebId = (market: Market) => `superzoo_${market.country.toLowerCase()}`;
const FACET_GROUPS = ['brands', 'parameters', 'campaigns', 'categories', 'reviews', 'prices', 'tags'];
const publicJson = (body: unknown, replacer?: (key: string, value: unknown) => unknown): RequestInit => ({
  method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body, replacer),
});
const { rawJSON } = JSON as typeof JSON & { rawJSON(text: string): object };

function catalogueRangeNumbers(key: string, value: unknown) {
  // The filter endpoint requires JSON floats for range bounds, even at integer values.
  if ((key !== 'from' && key !== 'to') || typeof value !== 'number' || !Number.isInteger(value)) return value;
  const literal = String(value);
  return rawJSON(literal.includes('e') ? literal : `${literal}.0`);
}
type CatalogueMarket = Exclude<Market, { country: 'PL' }>;
type CatalogueScope = { category: string; productIds?: string[] } | { category?: string; productIds: string[] };
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
  query: catalogueKeyword,
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
const nullableText = z.string().nullable().optional();
const decimal = decimalText.nullable().optional();
const nonBlankText = z.string().regex(/\S/);
const categoryPageSchema = z.object({
  products: z.array(z.object({ id: idSchema })).max(CATEGORY_PAGE_SIZE),
  totalCount: z.number().int().nonnegative(),
}).refine(({ products, totalCount }) =>
  products.length <= totalCount && new Set(products.map(product => product.id)).size === products.length);
const facetResponseSchema = z.object({ totalCount: z.number().int().nonnegative(), facets: rawFacetsSchema });

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
    const { candidates, source, checked_at, upstreamTotal, itemsChecked, limitReached } =
      await this.searchCandidates(query, requestContext);
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
      ...context(this.market, source, checked_at), query, products,
      upstream_total_count: upstreamTotal, total_count_is_product_count: false,
      candidates_checked: itemsChecked,
      candidate_limit_reached: limitReached,
      requested_limit_filled: products.length === limit,
      filters_applied: filters,
      products_checked: productsChecked,
      detail_failures: detailFailures,
      coverage: 'bounded_candidates',
    };
  }

  private async searchCandidates(query: string, requestContext: RequestContext) {
    const url = new URL(`${SEARCH}/mutations/${marketWebId(this.market)}/languages/${this.market.language}/search`);
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
    return {
      candidates, source: url.toString(), checked_at, upstreamTotal: data.totalCount, itemsChecked: items.length,
      limitReached: data.totalCount > items.length || data.items.length > items.length,
    };
  }

  private catalogueMarket(): CatalogueMarket {
    if (this.market.country === 'PL') {
      throw new SuperzooError('not_found', `Category browsing is not supported in ${this.market.name}`);
    }
    return this.market;
  }

  private async catalogueNavigation(market: CatalogueMarket, requestContext: RequestContext) {
    const { data } = await this.policy.request({
      market: market.country, operation: 'category_navigation',
      url: `${market.web}/web-api/navigation/animal-category`,
      schema: navigationSchema, init: { credentials: 'omit' }, ...requestContext,
    });
    return data.items.flatMap(group => group.children.flatMap(child => {
      if (child.nodeType !== 'productCategory') return [];
      const entry = navigationCategorySchema.safeParse(child);
      if (!entry.success) throw new SuperzooError('invalid_response', 'Superzoo returned an invalid category entry');
      const { id, name, alias } = entry.data;
      return [{ alias, descriptor: { category_id: id, name: name.trim() || alias,
        department: group.categoryType, department_name: group.text } }];
    }));
  }

  private async resolveCatalogueCategory(market: CatalogueMarket, categoryId: string, requestContext: RequestContext) {
    const categories = await this.catalogueNavigation(market, requestContext);
    const category = categories.find(entry => entry.descriptor.category_id === categoryId);
    if (!category) throw new SuperzooError('not_found', 'Category ID is unavailable in this market');

    const { data } = await this.policy.request({
      market: market.country, operation: 'category_route',
      url: this.catalogueModelUrl(market, 'route'), schema: routeSchema,
      init: publicJson({ ids: [category.alias] }), ...requestContext,
    });
    const routes = data.items.filter(({ route }) => route.alias === category.alias);
    if (routes.length !== 1 || routes[0]!.route.settings.templateId !== 'productCatalogue:category:CATEGORY') {
      throw new SuperzooError('not_found', 'No catalogue route is available for this category');
    }
    return { descriptor: category.descriptor, scopeId: routes[0]!.route.settings.resourceId };
  }

  private catalogueModelUrl(market: CatalogueMarket, collection: 'route' | 'product') {
    return `https://read-model.superzoo.cz/collections/${collection}/webs/${marketWebId(market)}/languages/${market.language}/documents/filter`;
  }

  private async catalogueScope(market: CatalogueMarket, input: { category_id?: string | undefined; query?: string | undefined },
    requestContext: RequestContext) {
    const [category, search] = await Promise.all([
      input.category_id === undefined ? undefined : this.resolveCatalogueCategory(market, input.category_id, requestContext),
      input.query === undefined ? undefined : this.searchCandidates(input.query, requestContext),
    ]);
    const scope: CatalogueScope = search
      ? { ...(category && { category: category.scopeId }), productIds: search.candidates.map(candidate => candidate.id) }
      : { category: category!.scopeId };
    return { scope, category, search };
  }

  private filterSource(market: CatalogueMarket) {
    return `https://parameter-filter.superzoo.cz/filter-products/${marketWebId(market)}`;
  }

  private async catalogueRequest<T extends { totalCount: number }>(market: CatalogueMarket, schema: z.ZodType<T>, scope: CatalogueScope,
    args: { page: number; limit: number; query?: object; inStock?: boolean | undefined; sort?: { sortBy: string; order: string } | undefined },
    requestContext: RequestContext) {
    const result = await this.policy.request({
      market: market.country, operation: 'category_filter', url: this.filterSource(market), schema,
      init: publicJson({
        priceLevel: market.priceLevel, scope,
        filters: { onlyOnSale: true, onlyInStock: args.inStock ?? false, promotedOnly: false },
        facets: FACET_GROUPS, query: args.query ?? {}, paging: { page: args.page, limit: args.limit },
        ...(args.sort && { sort: args.sort }),
      }, catalogueRangeNumbers), ...requestContext,
    });
    if (scope.productIds && result.data.totalCount > scope.productIds.length) {
      throw new SuperzooError('invalid_response', 'Superzoo returned a total outside the keyword candidate set');
    }
    return result;
  }

  private async catalogueFacets(market: CatalogueMarket, scope: CatalogueScope, requestContext: RequestContext) {
    const { data, checked_at } = await this.catalogueRequest(
      market, facetResponseSchema, scope, { page: 1, limit: 1 }, requestContext);
    return { raw: data.facets, total: data.totalCount, checked_at };
  }

  private catalogueFacetLabels(market: CatalogueMarket, raw: RawFacets, categoryId: string | undefined,
    requestContext: RequestContext) {
    return this.policy.request({
      market: market.country, operation: 'category_facet_labels', url: `${market.web}/web-api/products/parameter-filter`,
      schema: facetLabelsSchema, init: publicJson({ facets: raw,
        ...(categoryId && { scope: { type: 'category', categoryId } }) }),
      ...requestContext,
    });
  }

  async listProductCategories(input: z.input<typeof listProductCategoriesInput>,
    requestContext: RequestContext = {}): Promise<ListProductCategoriesResult> {
    const args = listProductCategoriesInput.parse(input);
    const market = this.catalogueMarket();
    if (args.category_id === undefined && args.query === undefined) {
      const entries = await this.catalogueNavigation(market, requestContext);
      return {
        market: market.country,
        categories: entries.map(({ descriptor }) => descriptor)
          .filter(entry => !args.department || entry.department === args.department),
      };
    }

    const { scope, category, search } = await this.catalogueScope(market, args, requestContext);
    const { raw, total, checked_at } = scope.productIds?.length === 0
      ? { raw: {}, total: 0, checked_at: search!.checked_at }
      : await this.catalogueFacets(market, scope, requestContext);
    const labels = total === 0 ? null : await this.catalogueFacetLabels(market, raw, scope.category, requestContext)
      .then(result => result.data, (error: unknown) => {
        if (!(error instanceof SuperzooError) || error.code === 'cancelled' || error.code === 'internal_error') throw error;
        return null;
      });
    return {
      market: market.country,
      categories: category ? [category.descriptor] : [],
      ...(args.query !== undefined && { query: args.query, candidate_limit_reached: search!.limitReached }),
      source: scope.productIds?.length === 0 ? search!.source : this.filterSource(market), checked_at,
      upstream_total_count: total, labels_available: labels !== null, filters: describeFilters(raw, labels ?? {}, market.currency),
    };
  }

  async browseProducts(input: BrowseProductsInput, requestContext: RequestContext = {}): Promise<BrowseProductsResult> {
    const market = this.catalogueMarket();
    const args = browseProductsInput.parse(input);
    const { category_id, query: keyword, page, facets, offer, catalogue_price, brands, subcategories, campaigns, tags,
      ratings, only_in_stock, sort } = args;
    const { scope, search } = await this.catalogueScope(market, args, requestContext);
    const noCandidates = scope.productIds?.length === 0;
    const parameters = Object.entries(facets ?? {}).map(([alias, value]) =>
      ({ alias, values: Array.isArray(value) ? value : [value] }));
    const needsTypes = sort === 'unit_price_asc' ||
      parameters.some(parameter => parameter.values.some(value => typeof value === 'object'));
    if (!noCandidates && (parameters.length || brands || subcategories || campaigns || tags || needsTypes)) {
      const { raw, total } = await this.catalogueFacets(market, scope, requestContext);
      if (total > 0) {
        const labels = needsTypes ? (await this.catalogueFacetLabels(market, raw, scope.category, requestContext)).data : undefined;
        validateCatalogueSelection(args, raw, labels);
      }
    }
    const query = {
      ...(parameters.length && { parameters }),
      ...(catalogue_price && { price: [catalogue_price] }),
      ...(brands && { brands }),
      ...(subcategories && { categories: subcategories }),
      ...(campaigns && { campaigns }),
      ...(tags && { tags }),
      ...(ratings && { reviews: ratings }),
    };
    const { data: filtered, checked_at } = noCandidates
      ? { data: { products: [], totalCount: 0 }, checked_at: search!.checked_at }
      : await this.catalogueRequest(market, categoryPageSchema, scope, {
        page, limit: CATEGORY_PAGE_SIZE, query, inStock: only_in_stock,
        sort: sort ? sortRequests[sort] : search ? { sortBy: 'idsList', order: 'asc' } : undefined,
      }, requestContext);
    const ids = filtered.products.map(product => product.id);
    const { productIds } = scope;
    if (productIds && ids.some(id => !productIds.includes(id))) {
      throw new SuperzooError('invalid_response', 'Superzoo returned products outside the keyword candidate set');
    }
    const result = {
      market: market.country, source: noCandidates ? search!.source : this.filterSource(market), checked_at,
      category_id: category_id ?? null, facets_applied: facets ?? {},
      ...(keyword === undefined ? {} : { query: keyword, candidate_limit_reached: search!.limitReached }),
      coverage: search ? 'bounded_candidates' : page === 1 ? 'first_page' : 'category_page',
      page, next_page: page < Math.ceil(filtered.totalCount / CATEGORY_PAGE_SIZE) ? page + 1 : null,
      upstream_total_count: filtered.totalCount, candidates_checked: ids.length,
      ...(offer === undefined ? {} : { offer_filter: { mode: offer, details_checked: 0, detail_failures: 0 } }),
    } satisfies Omit<BrowseProductsResult, 'product_source' | 'eligible_count' | 'products'>;
    if (ids.length === 0) return { ...result, product_source: null, eligible_count: 0, products: [] };

    const webId = marketWebId(market);
    const priceLevel = market.priceLevel;
    const product_source = this.catalogueModelUrl(market, 'product');
    const { data: records } = await this.policy.request({
      market: market.country, operation: 'category_products', url: product_source, schema: categoryProductsSchema,
      init: publicJson({ ids }), ...requestContext,
    });
    const byId = new Map(records.items.map(item => [item.product.productId, item]));
    if (byId.size !== records.items.length || [...byId.keys()].some(id => !ids.includes(id))) {
      throw new SuperzooError('invalid_response', 'Superzoo category product records did not match the requested IDs');
    }
    const products = ids.flatMap(id => {
      const record = byId.get(id);
      if (!record) return [];
      const { product, prices } = record;
      if (!product.published || product.productSaleForbidden || product.disallowedPriceLevels.includes(priceLevel) ||
          !prices.some(price => price.productId === id && price.webId === webId && price.priceLevelId === priceLevel)) return [];
      return [{ product_id: id, name: product.name, url: link(market, product.alias) }];
    });
    const eligible = { ...result, product_source, eligible_count: products.length };
    if (offer === undefined) return { ...eligible, products };

    // The shared request policy caps concurrency and caches public product details.
    const details = await Promise.allSettled(products.map(({ product_id }) => this.getProduct({ product_id }, requestContext)));
    if (requestContext.signal?.aborted) throw new SuperzooError('cancelled', 'Superzoo request cancelled');
    let detail_failures = 0;
    const matches = details.flatMap((detail, index) => {
      if (detail.status === 'rejected') {
        if (detail.reason instanceof SuperzooError && detail.reason.code === 'cancelled') throw detail.reason;
        detail_failures++;
        return [];
      }
      const { price, checked_at: price_checked_at } = detail.value;
      if (price?.amount == null || price.original_amount === null ||
          compareDecimals(price.amount, price.original_amount) >= 0) return [];
      const isSale = price.variant === 'sale';
      const isFamily = price.variant === 'familyPrice' || price.variant === 'topPriceFamilySale';
      if (!(isSale && offer !== 'family') && !(isFamily && offer !== 'sale')) return [];
      return [{ ...products[index]!, price, price_checked_at }];
    });
    return {
      ...eligible,
      offer_filter: { mode: offer, details_checked: details.length, detail_failures },
      products: matches,
    };
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
