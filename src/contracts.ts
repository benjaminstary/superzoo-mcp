import { z } from 'zod';
import { productInput, availabilityInput } from './client.js';

export type RequestContext = { signal?: AbortSignal };

const productId = productInput.shape.product_id;
const market = z.enum(['SK', 'CZ', 'PL']);
const timestamp = z.iso.datetime();
const nullableText = z.string().nullable();
const upstreamText = nullableText.optional();
const decimal = z.string().regex(/^\d+(?:\.\d+)?$/).nullable();
const count = z.number().int().nonnegative();
const provenance = { source: z.string(), market, checked_at: timestamp };

export const toolErrorSchema = z.object({
  code: z.enum(['not_found', 'rate_limited', 'upstream_unavailable', 'invalid_response',
    'timeout', 'cancelled', 'overloaded', 'internal_error']),
  message: z.string(),
  retryable: z.boolean(),
});

const price = z.object({
  amount: decimal,
  currency: z.enum(['EUR', 'CZK', 'PLN']),
  context: z.literal('public_online'),
  variant: nullableText,
  original_amount: decimal,
  lowest_amount: decimal,
  // These upstream fields are opaque today; preserve them without claiming a shape.
  sale_percentage: z.unknown(),
  voucher_campaign: z.unknown(),
}).nullable();
const availability = z.object({
  availableStoresCount: count.nullable().optional(),
  storeAvailability: z.object({ text: upstreamText, availability: upstreamText }).nullable().optional(),
  deliveryAvailability: z.object({ text: upstreamText, availability: upstreamText }).nullable().optional(),
  isFreeDelivery: z.boolean().optional(),
}).passthrough().nullable();

export const productResultSchema = z.object({
  ...provenance,
  product_id: productId,
  name: z.string().min(1),
  url: z.string(),
  ean: nullableText,
  catalogue_number: nullableText,
  brand: nullableText,
  can_buy: z.boolean().nullable(),
  price,
  variants: z.array(z.object({
    variantName: z.string(),
    variants: z.array(z.object({
      id: productId, name: z.string(), alias: z.string(),
      isActive: z.boolean(), isDisabled: z.boolean(),
    })),
  }).passthrough()),
  availability,
});
export type ProductResult = z.output<typeof productResultSchema>;

const store = z.object({
  store_id: z.string(), name: z.string(), address: z.string(), url: z.string(),
  opening_hours_html: nullableText,
  // Undocumented status codes must survive; quantity is never inferred.
  status: z.string(), pickup_text: nullableText, quantity: z.null(),
});
export const availabilityResultSchema = z.object({
  ...provenance,
  product_id: productId,
  city_filter: nullableText,
  total_stores: count,
  stores: z.array(store),
});
export type AvailabilityResult = z.output<typeof availabilityResultSchema>;

const partialSearchProduct = z.object({
  product_id: productId, name: z.string(), description: nullableText, url: z.string(),
  price: z.null(), availability: z.null(), detail_error: z.string(),
});
export const searchResultSchema = z.object({
  ...provenance,
  query: z.string(),
  products: z.array(z.union([productResultSchema.extend({ description: nullableText }), partialSearchProduct])),
  upstream_total_count: count,
  total_count_is_product_count: z.literal(false),
  candidates_checked: count,
  candidate_limit_reached: z.boolean(),
  requested_limit_filled: z.boolean(),
  // Added by the discovery task; optional so current results stay valid.
  filters_applied: z.object({
    brand: z.string().optional(),
    min_price: z.string().regex(/^\d+(?:\.\d+)?$/).optional(),
    max_price: z.string().regex(/^\d+(?:\.\d+)?$/).optional(),
    // Reserved pending verification; this schema does not enable a runtime filter.
    online_only: z.boolean().optional(),
  }).optional(),
  products_checked: count.optional(),
  coverage: z.literal('bounded_candidates').optional(),
});
export type SearchResult = z.output<typeof searchResultSchema>;

export const productBatchInput = z.object({
  product_ids: z.array(productId).min(1).max(10)
    .refine(ids => new Set(ids).size === ids.length, 'Product IDs must be unique'),
});
export type ProductBatchInput = z.input<typeof productBatchInput>;
export const commonStoresInput = productBatchInput.extend({ city: availabilityInput.shape.city });
export type CommonStoresInput = z.input<typeof commonStoresInput>;

const batch = {
  market,
  // Completion time; nested products/observations retain their original retrieval time.
  checked_at: timestamp,
  product_ids: productBatchInput.shape.product_ids,
  complete: z.boolean(),
};
export const comparisonResultSchema = z.object({
  ...batch,
  products: z.array(z.union([
    z.object({ product_id: productId, product: productResultSchema, error: z.null() }),
    z.object({ product_id: productId, product: z.null(), error: toolErrorSchema }),
  ])),
});
export type ComparisonResult = z.output<typeof comparisonResultSchema>;

export const commonStoresResultSchema = z.object({
  ...batch,
  city_filter: nullableText,
  // Lookup outcomes remain visible even if no stores were observed.
  products: z.array(z.union([
    z.object({ product_id: productId, checked_at: timestamp, error: z.null() }),
    z.object({ product_id: productId, checked_at: z.null(), error: toolErrorSchema }),
  ])),
  stores: z.array(z.object({
    store_id: z.string(), name: z.string(), address: z.string(), url: z.string(),
    products: z.array(z.object({
      product_id: productId,
      status: nullableText,
      pickup_text: nullableText,
      checked_at: timestamp.nullable(),
      error: toolErrorSchema.nullable(),
    })),
    all_in_stock: z.boolean(),
  })),
});
export type CommonStoresResult = z.output<typeof commonStoresResultSchema>;
