import { z } from 'zod';
import { SuperzooError } from './errors.js';

export const catalogueId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/);
const text = z.string().regex(/\S/);
const count = z.number().int().nonnegative();
const alias = z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/);
const value = z.string().min(1).max(200);
const ids = z.array(catalogueId).min(1).max(100);
const range = z.strictObject({ from: z.number(), to: z.number() })
  .refine(({ from, to }) => from <= to, { message: 'Range end must be at least the start' });
const priceRange = range.refine(({ from }) => from >= 0, { message: 'Catalogue price cannot be negative' });

export const catalogueKeyword = z.string().trim().min(1).max(200);
export const catalogueFacets = z.record(alias, z.union([value, z.array(value).min(1).max(100), range]))
  .refine(facets => Object.keys(facets).length <= 100, { message: 'Use at most 100 parameter filters' })
  .describe('Use parameter keys and exact values from list_product_categories. Pass a string, alternative strings, or a numeric {from,to} range.');
export const categoryIdSchema = catalogueId.describe('Navigation category ID from list_product_categories.');
export const categoryPageNumber = z.number().int().positive();
export const categoryOffer = z.enum(['deals', 'sale', 'family']);
export const catalogueSort = z.enum(['price_asc', 'price_desc', 'unit_price_asc', 'popularity', 'rating']);
const scope = {
  category_id: categoryIdSchema.optional(),
  query: catalogueKeyword.optional().describe('Keyword search within up to 200 upstream candidates. Can be combined with a category.'),
};
export const listProductCategoriesInput = z.strictObject({
  ...scope,
  department: catalogueId.optional().describe('Optional department code, such as aquaristics. Applies to the navigation list.'),
}).refine(input => !input.department || (!input.category_id && !input.query), {
  path: ['department'], message: 'Use department when listing categories, or category_id and/or query when discovering filters',
});
export const catalogueSelection = z.strictObject({
  facets: catalogueFacets.optional(),
  brands: ids.optional(),
  subcategories: ids.optional().describe('Category facet IDs from scoped discovery.'),
  campaigns: ids.optional(),
  tags: ids.optional(),
  ratings: z.array(z.number().int().min(1).max(5)).min(1).max(5).optional(),
  catalogue_price: priceRange.optional().describe('Catalogue price range in the market currency. Public offer prices can differ.'),
  only_in_stock: z.boolean().optional().describe('Use the upstream catalogue stock flag. Check branch stock separately.'),
  sort: catalogueSort.optional().describe('Catalogue order. Use unit_price_asc when discovery advertises it.'),
  offer: categoryOffer.optional().describe('Keep advertised sales, Family member prices, or both, after checking this page.'),
});
export const browseProductsInput = catalogueSelection.extend({
  ...scope,
  page: categoryPageNumber.default(1).describe('Use next_page with the same inputs to continue, including after an empty page.'),
}).refine(({ category_id, query }) => category_id !== undefined || query !== undefined, {
  path: ['category_id'], message: 'Supply category_id, query, or both',
});
export type BrowseProductsInput = z.input<typeof browseProductsInput>;

export const navigationSchema = z.object({
  items: z.array(z.object({
    categoryType: catalogueId, text,
    children: z.array(z.object({ nodeType: z.string() }).passthrough()),
  })),
});

export const navigationCategorySchema = z.object({ id: catalogueId, name: z.string(), alias: text });

export const routeSchema = z.object({
  items: z.array(z.object({
    route: z.object({
      alias: text,
      settings: z.object({ templateId: text, resourceId: catalogueId }),
    }),
  })),
});

const idFacet = z.looseObject({ values: z.array(z.looseObject({ id: catalogueId, count })) });
const amount = z.string().regex(/^\d+(?:\.\d+)?$/);
export const rawFacetsSchema = z.object({
  parameters: z.array(z.looseObject({ id: catalogueId, alias, values: z.array(z.looseObject({ value, count })) })).optional(),
  brands: idFacet.optional(),
  categories: idFacet.optional(),
  campaigns: idFacet.optional(),
  tags: idFacet.optional(),
  review: z.looseObject({ values: z.array(z.looseObject({ value: z.number().int().min(1).max(5), count })) }).optional(),
  price: z.looseObject({ global: z.looseObject({ min: amount, max: amount }).nullish() }).optional(),
}).passthrough();
export type RawFacets = z.output<typeof rawFacetsSchema>;

const namedValue = z.object({ value: z.union([text, z.number()]), name: text });
const categoryLabel: z.ZodType<{ id: string; name: string; categories?: { id: string; name: string }[] | undefined }> =
  z.object({ id: catalogueId, name: text, get categories() { return z.array(categoryLabel).optional(); } });
const namedValues = z.object({ values: z.array(namedValue) });
export const facetLabelsSchema = z.object({
  parameters: z.array(z.object({ id: catalogueId, alias, name: text, type: text, values: z.array(namedValue) })).optional(),
  brands: namedValues.optional(),
  campaigns: namedValues.optional(),
  tags: namedValues.optional(),
  categories: z.object({ values: z.array(categoryLabel) }).optional(),
  canSortByPricePerUnit: z.boolean().optional(),
});

const idChoice = z.object({ id: catalogueId, count, name: text.optional() });
export const catalogueFilters = z.object({
  parameters: z.array(z.object({
    id: catalogueId, key: alias, name: text.optional(), type: z.enum(['choice', 'number', 'unknown']),
    values: z.array(z.object({ value, count, name: text.optional() })),
  })),
  brands: z.array(idChoice),
  subcategories: z.array(idChoice),
  campaigns: z.array(idChoice),
  tags: z.array(idChoice),
  ratings: z.array(z.object({ value: z.number().int().min(1).max(5), count })),
  price: z.object({ min: amount, max: amount, currency: z.enum(['EUR', 'CZK']) }).nullable(),
  sorts: z.array(catalogueSort),
});

export const sortRequests = {
  price_asc: { sortBy: 'prices', order: 'asc' },
  price_desc: { sortBy: 'prices', order: 'desc' },
  unit_price_asc: { sortBy: 'pricesPerUnit', order: 'asc' },
  popularity: { sortBy: 'soldCount', order: 'desc' },
  rating: { sortBy: 'review', order: 'desc' },
} as const;

export type FacetLabels = z.output<typeof facetLabelsSchema>;

export function describeFilters(raw: RawFacets, labels: FacetLabels, currency: 'EUR' | 'CZK') {
  const parameters = new Map(labels.parameters?.map(parameter => [parameter.alias, parameter]));
  const names = (entries: z.output<typeof namedValues> | undefined) =>
    new Map(entries?.values.map(({ value, name }) => [String(value), name]));
  const categoryNames = new Map<string, string>();
  const queue = [...(labels.categories?.values ?? [])];
  while (queue.length) {
    const { id, name, categories } = queue.pop()!;
    categoryNames.set(id, name);
    for (const child of categories ?? []) queue.push(child);
  }
  const choices = (facet: z.output<typeof idFacet> | undefined, labels = new Map<string, string>()) =>
    (facet?.values ?? []).map(({ id, count }) => {
      const name = labels.get(id);
      return { id, count, ...(name === undefined ? {} : { name }) };
    });
  return {
    parameters: (raw.parameters ?? []).map(parameter => {
      const metadata = parameters.get(parameter.alias);
      const label = metadata?.id === parameter.id ? metadata : undefined;
      const valueNames = new Map(label?.values.map(({ value, name }) => [String(value), name]));
      return {
        id: parameter.id, key: parameter.alias, ...(label ? { name: label.name } : {}),
        type: label?.type === 'number' ? 'number' as const : label ? 'choice' as const : 'unknown' as const,
        values: parameter.values.map(({ value, count }) => {
          const name = valueNames.get(value);
          return { value, count, ...(name === undefined ? {} : { name }) };
        }),
      };
    }),
    brands: choices(raw.brands, names(labels.brands)),
    subcategories: choices(raw.categories, categoryNames),
    campaigns: choices(raw.campaigns, names(labels.campaigns)),
    tags: choices(raw.tags, names(labels.tags)),
    ratings: raw.review?.values.map(({ value, count }) => ({ value, count })) ?? [],
    price: raw.price?.global ? { min: raw.price.global.min, max: raw.price.global.max, currency } : null,
    sorts: (Object.keys(sortRequests) as (keyof typeof sortRequests)[])
      .filter(sort => sort !== 'unit_price_asc' || labels.canSortByPricePerUnit === true),
  } satisfies z.output<typeof catalogueFilters>;
}

export function validateCatalogueSelection(selection: z.output<typeof catalogueSelection>, raw: RawFacets, labels?: FacetLabels) {
  const invalid = (field: string) => {
    throw new SuperzooError('invalid_input', `Invalid ${field} for this selection. Refresh filters with list_product_categories.`);
  };
  const parameters = new Map(raw.parameters?.map(parameter => [parameter.alias, parameter]));
  const numericParameters = new Map(labels?.parameters?.filter(parameter => parameter.type === 'number')
    .map(parameter => [parameter.alias, parameter.id]));
  for (const [key, selected] of Object.entries(selection.facets ?? {})) {
    const allowed = parameters.get(key);
    if (!allowed) { invalid(`facet "${key}"`); continue; }
    const matches = typeof selected === 'object' && !Array.isArray(selected)
      ? numericParameters.get(key) === allowed.id
      : (Array.isArray(selected) ? selected : [selected]).every(value => allowed.values.some(choice => choice.value === value));
    if (!matches) invalid(`values for facet "${key}"`);
  }
  for (const [key, facet] of [
    ['brands', raw.brands], ['subcategories', raw.categories], ['campaigns', raw.campaigns], ['tags', raw.tags],
  ] as const) {
    const selected = selection[key];
    if (selected && !selected.every(id => facet?.values.some(value => value.id === id))) invalid(key);
  }
  if (selection.sort === 'unit_price_asc' && labels?.canSortByPricePerUnit !== true) invalid('unit price sort');
}
