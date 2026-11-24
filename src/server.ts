import type { z } from 'zod';
import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { SuperzooClient, searchInput, productInput, availabilityInput, findStoresInput, deliveryOptionsInput,
  listProductCategoriesInput, browseProductsInputs } from './client.js';
import { productResultSchema, availabilityResultSchema, searchResultSchema, findStoresResultSchema, deliveryOptionsResultSchema,
  comparisonResultSchema, commonStoresResultSchema, productBatchInput, commonStoresInput,
  listProductCategoriesResultSchema, browseProductsResultSchema } from './contracts.js';
import type { RequestContext } from './contracts.js';
import { compareProducts, findCommonStores } from './shopping.js';
import { toToolError } from './errors.js';

const { version }: { version: string } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

function handleTool<Input>(run: (args: Input, context: RequestContext) => Promise<Record<string, unknown>>) {
  return async (args: Input, extra: { signal: AbortSignal }): Promise<CallToolResult> => {
    try {
      const data = await run(args, { signal: extra.signal });
      return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: JSON.stringify(toToolError(error)) }] };
    }
  };
}

export function createServer(client = new SuperzooClient()) {
  const { name, currency } = client.market;
  const server = new McpServer({ name: 'superzoo-mcp', version });
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
  server.registerTool('search_products', {
    description: `Find Superzoo products in ${name}, with public online ${currency} offers and availability summaries. `
      + 'Default 10, max 50 results. Search checks up to 200 mixed candidates; upstream totals are not product counts. '
      + 'Optional brand and inclusive decimal price filters apply within this bounded window; omitted candidates may contain matches. '
      + 'online_only requires explicit delivery availability. Conditional offers remain conditional. '
      + 'Enriched products include ratings, localized attributes, and unit prices when supplied. '
      + 'Partial detail failures are marked on each product. Use variant-specific product IDs for stock lookups.',
    inputSchema: searchInput, outputSchema: searchResultSchema, annotations,
  }, handleTool((args: z.input<typeof searchInput>, context) => client.searchProducts(args, context)));
  server.registerTool('get_product', {
    description: `Get product details, variants, public online ${currency} offers in ${name}, delivery availability and available-store count. `
      + 'Includes localized attributes, ratings on the upstream scale, and unit prices when supplied. '
      + 'Price variant identifies conditional offers such as familyPrice; membership eligibility and branch prices are not verified.',
    inputSchema: productInput, outputSchema: productResultSchema, annotations,
  }, handleTool((args: z.input<typeof productInput>, context) => client.getProduct(args, context)));
  server.registerTool('get_product_availability', {
    description: `Get availability in ${name} stores for one product variant. Optional city filters store name/address locally, ignoring accents. `
      + 'Stock status and pickup text are separate. No exact quantities or branch prices. Check checked_at for freshness.',
    inputSchema: availabilityInput, outputSchema: availabilityResultSchema, annotations,
  }, handleTool((args: z.input<typeof availabilityInput>, context) => client.getProductAvailability(args, context)));
  server.registerTool('compare_products', {
    description: `Compare one to ten unique product variants in ${name}, preserving input order and conditional ${currency} offers. `
      + 'Includes ratings, localized attributes, and unit prices when supplied. '
      + 'Partial failures remain explicit. Product checked_at values retain their original retrieval times.',
    inputSchema: productBatchInput, outputSchema: comparisonResultSchema, annotations,
  }, handleTool((args: z.input<typeof productBatchInput>, context) => compareProducts(client, args, context)));
  server.registerTool('find_common_stores', {
    description: `Find stores for one to ten unique product variants in ${name}, optionally filtered by city. `
      + 'all_in_stock requires explicit inStock for every requested product. Missing observations and failures remain unknown. '
      + 'Pickup text is separate from stock; quantities and branch prices are unknown.',
    inputSchema: commonStoresInput, outputSchema: commonStoresResultSchema, annotations,
  }, handleTool((args: z.input<typeof commonStoresInput>, context) => findCommonStores(client, args, context)));
  if (client.market.storeLocatorPath !== null) {
    server.registerTool('find_stores', {
      description: `Find the Superzoo branch returned as nearest to a pair of coordinates in ${name}. `
        + 'Returns up to one branch, with its ID, address, and available branch coordinates. '
        + 'Use get_product_availability for product stock.',
      inputSchema: findStoresInput, outputSchema: findStoresResultSchema, annotations,
    }, handleTool((args: z.input<typeof findStoresInput>, context) => client.findStores(args, context)));
  }
  if (client.market.deliveryQuoteWebId !== null) {
    server.registerTool('get_delivery_options', {
      description: `Quote delivery for one or two units of a product variant in ${name}. Defaults to one unit. `
        + 'Returns market-level prices and dates plus pickup places supplied with each method. '
        + 'The quote has no address-specific availability or delivery commitment.',
      inputSchema: deliveryOptionsInput, outputSchema: deliveryOptionsResultSchema, annotations,
    }, handleTool((args: z.input<typeof deliveryOptionsInput>, context) => client.getDeliveryOptions(args, context)));
  }
  if (client.market.country !== 'PL') {
    const browseProductsInput = browseProductsInputs[client.market.country];
    server.registerTool('list_product_categories', {
      description: `List supported browsing categories in ${name} with valid facet keys and values.`,
      inputSchema: listProductCategoriesInput, outputSchema: listProductCategoriesResultSchema, annotations,
    }, handleTool((args: z.input<typeof listProductCategoriesInput>) => client.listProductCategories(args)));
    server.registerTool('browse_products', {
      description: `Browse one page of dry dog food in ${name}. Use list_product_categories for the category ID and facet values. `
        + 'Accepts an optional dog-age facet and defaults to page 1. Pass next_page with the same category and facets to see more. '
        + 'Checks up to ten candidates for publication and local public sale eligibility. '
        + 'The upstream total counts matches before those checks. Use get_product for full details.',
      inputSchema: browseProductsInput, outputSchema: browseProductsResultSchema, annotations,
    }, handleTool((args: z.input<typeof browseProductsInput>, context) => client.browseProducts(args, context)));
  }
  return server;
}
