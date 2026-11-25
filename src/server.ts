import type { z } from 'zod';
import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { browseProductsInput, listProductCategoriesInput } from './categories.js';
import { SuperzooClient, searchInput, productInput, availabilityInput, findStoresInput, deliveryOptionsInput } from './client.js';
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
  const productLink = 'Link recommended products using the returned product page URL and show the confirmed pack size when known. ';
  const membershipPrice = 'Label prices with requires_membership: true as Family member prices. Null means the membership requirement is unknown. ';
  server.registerTool('search_products', {
    description: `Look up Superzoo products by name or keyword in ${name}, with public online ${currency} offers and availability summaries. `
      + (client.market.country === 'PL' ? '' : 'For shopping by category, brand and product attributes, discover filters with list_product_categories and apply them with browse_products. ')
      + 'Default 10, max 50 results. Search checks up to 200 mixed candidates; upstream totals are not product counts. '
      + 'Optional brand and inclusive decimal price filters apply within this bounded window; omitted candidates may contain matches. '
      + 'online_only requires explicit delivery availability. Conditional offers remain conditional. '
      + 'Enriched products include ratings, localized attributes, and unit prices when supplied. '
      + productLink + membershipPrice
      + 'Partial detail failures are marked on each product. Use variant-specific product IDs for stock lookups.',
    inputSchema: searchInput, outputSchema: searchResultSchema, annotations,
  }, handleTool((args: z.input<typeof searchInput>, context) => client.searchProducts(args, context)));
  server.registerTool('get_product', {
    description: `Get product details, variants, public online ${currency} offers in ${name}, delivery availability and available-store count. `
      + 'Includes localized attributes, ratings on the upstream scale, and unit prices when supplied. '
      + productLink + membershipPrice
      + 'Online offers preserve the original price variant. Shopper eligibility and branch prices are unverified.',
    inputSchema: productInput, outputSchema: productResultSchema, annotations,
  }, handleTool((args: z.input<typeof productInput>, context) => client.getProduct(args, context)));
  server.registerTool('get_product_availability', {
    description: `Get availability in ${name} stores for one product variant. Optional city filters store name/address locally, ignoring accents. `
      + 'Stock status and pickup text are separate. No exact quantities or branch prices. Check checked_at for freshness.',
    inputSchema: availabilityInput, outputSchema: availabilityResultSchema, annotations,
  }, handleTool((args: z.input<typeof availabilityInput>, context) => client.getProductAvailability(args, context)));
  server.registerTool('compare_products', {
    description: `Compare one to ten unique product variants in ${name}, preserving input order and conditional ${currency} offers. `
      + 'Includes ratings on the upstream scale, localized attributes, and unit prices when supplied. '
      + productLink + membershipPrice
      + 'State the scope when ranking prices. Compare unit prices on the same unit and quantity. '
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
        + 'With address_checked: false, present delivery prices and dates as market-level quotes. Wolt availability and timing for a specific location require location-specific evidence. '
        + 'Report each pickup place using its own availability and date when supplied.',
      inputSchema: deliveryOptionsInput, outputSchema: deliveryOptionsResultSchema, annotations,
    }, handleTool((args: z.input<typeof deliveryOptionsInput>, context) => client.getDeliveryOptions(args, context)));
  }
  if (client.market.country !== 'PL') {
    server.registerTool('list_product_categories', {
      description: `Discover shopping categories and filters in ${name}. With no arguments or just department, list navigation and category IDs. `
        + 'Call again with category_id to get filters and sorts for the chosen category. Include query here if the browse will also use it. '
        + 'A query alone discovers filters for a keyword search. Read filters.brands for brand IDs and filters.parameters for exact attribute keys and values. '
        + 'Counts cover catalogue candidates before eligibility checks.',
      inputSchema: listProductCategoriesInput, outputSchema: listProductCategoriesResultSchema, annotations,
    }, handleTool((args: z.input<typeof listProductCategoriesInput>, context) => client.listProductCategories(args, context)));
    server.registerTool('browse_products', {
      description: `Find catalogue products in ${name} using category, brand and attribute filters. First call list_product_categories with the same category_id and/or query to discover filters. `
        + 'Pass brand IDs in top-level brands and attribute keys and values in facets. Combine them in one request. '
        + 'Different parameter keys must all match. Multiple choices for one key are alternatives. '
        + 'Catalogue prices and sorting can differ from public offers. Use get_product to confirm current prices and get_product_availability for branch stock. '
        + 'Use offer to find advertised sales, Family member prices, or both. Offer filtering checks the current page and includes published pack and unit prices when supplied. '
        + productLink + membershipPrice
        + 'Both familyPrice and topPriceFamilySale identify Family member prices. Use the returned amount as quoted. The published unit price may reflect the regular price. '
        + 'Pass next_page with the same inputs, including after an empty page. Keyword coverage is bounded to 200 upstream candidates. '
        + 'Checks up to ten candidates for publication and local public sale eligibility. '
        + 'The upstream total counts matches before eligibility and offer checks. Report price rankings within the checked results when coverage is incomplete.',
      inputSchema: browseProductsInput, outputSchema: browseProductsResultSchema, annotations,
    }, handleTool((args: z.input<typeof browseProductsInput>, context) => client.browseProducts(args, context)));
  }
  return server;
}
