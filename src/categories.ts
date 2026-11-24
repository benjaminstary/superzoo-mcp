import { z } from 'zod';

const dogAge = {
  CZ: { 'stari-psa': ['dospely', 'senior', 'stene'] },
  SK: { 'vek-psa': ['dospely', 'senior', 'stena'] },
} as const;

export const categoryMarkets = {
  CZ: 'superzoo_cz',
  SK: 'superzoo_sk',
} as const;

export const categories = {
  '42eeee01-5544-4e68-8130-bef9755298ae': {
    scopeId: 'c1955f56-7438-4c93-8875-9dc8f634acd9',
    CZ: { name: 'Granule pro psy', facets: { ...dogAge.CZ, alergie: ['bez-obilovin-grain-free-1'] } },
    SK: { name: 'Granuly pre psov', facets: { ...dogAge.SK, 'alergie-psa': ['bez-obilnin-grain-free'] } },
  },
  '4a0f2a97-fe83-479e-b76d-65818f053d9b': {
    scopeId: '57377452-e778-43d0-9853-870bd5116ad3',
    CZ: { name: 'Konzervy a kapsičky', facets: dogAge.CZ },
    SK: { name: 'Mokré krmivo', facets: dogAge.SK },
  },
  '4716d036-9322-41aa-975a-7a32a0735f0b': {
    scopeId: '927e5be1-9bd3-4d53-b710-af2966dd3958',
    CZ: { name: 'Granule pro kočky', facets: { 'stari-kocky': ['dospela-kocka', 'starsi-kocka', 'kote'] } },
    SK: { name: 'Granuly pre mačky', facets: { 'vek-macky': ['dospela-macka', 'starsia-macka', 'maciatko'] } },
  },
  'dfc861d8-9069-47db-b29b-5d6afee06f1f': {
    scopeId: '19291e00-26e0-464b-bd6a-b804296ffb14',
    CZ: { name: 'Stelivo pro kočky', facets: {
      'typ-steliva': ['hrudkujici', 'pohlcujici-pachy', 'hruba-1', 'jemne', 'pro-bile-kocky'],
    } },
    SK: { name: 'Podstielky', facets: {
      'typ-podstielky': ['hrudkujuca', 'pohlcujuca-pachy', 'hruba-1', 'jemna', 'pre-biele-macky'],
    } },
  },
} as const;

export const categoryIds = Object.keys(categories) as (keyof typeof categories)[];
export const categoryIdSchema = z.enum(categoryIds).describe('Category ID from list_product_categories.');
export const categoryPageNumber = z.number().int().positive();

function browseInput(market: keyof typeof categoryMarkets) {
  const facetShape = Object.fromEntries(Object.values(categories).flatMap(category =>
    Object.entries(category[market].facets).map(([key, values]) => [key, z.enum(values).optional()] as const)));
  return z.strictObject({
    category_id: categoryIdSchema,
    page: categoryPageNumber.default(1).describe('One-based page number. Use next_page with the same category and facets to continue.'),
    facets: z.strictObject(facetShape).optional()
      .describe('Use facet keys and values listed for this category by list_product_categories. Different keys must all match.'),
  }).refine(
    ({ category_id, facets }) => Object.keys(facets ?? {}).every(key => Object.hasOwn(categories[category_id][market].facets, key)),
    { path: ['facets'], message: 'Use only facets listed for the selected category' },
  );
}

export const browseProductsInputs = {
  CZ: browseInput('CZ'),
  SK: browseInput('SK'),
};
export type BrowseProductsInput = z.input<(typeof browseProductsInputs)[keyof typeof browseProductsInputs]>;
