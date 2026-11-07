import type { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { SuperzooClient, searchInput, productInput, availabilityInput } from './client.js';
import { productResultSchema, availabilityResultSchema, searchResultSchema,
  comparisonResultSchema, commonStoresResultSchema, productBatchInput, commonStoresInput } from './contracts.js';
import type { RequestContext } from './contracts.js';
import { compareProducts, findCommonStores } from './shopping.js';
import { toToolError } from './errors.js';

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
  const server = new McpServer({ name: 'superzoo-mcp', version: '0.1.0' });
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
  server.registerTool('search_products', {
    description: `Find Superzoo products in ${name}, with public online ${currency} offers and availability summaries. `
      + 'Default 10, max 50 results. Search checks up to 200 mixed candidates; upstream totals are not product counts. '
      + 'Optional brand and inclusive decimal price filters apply within this bounded window; omitted candidates may contain matches. '
      + 'online_only requires explicit delivery availability. Conditional offers remain conditional. '
      + 'Partial detail failures are marked on each product. Use variant-specific product IDs for stock lookups.',
    inputSchema: searchInput, outputSchema: searchResultSchema, annotations,
  }, handleTool((args: z.input<typeof searchInput>, context) => client.searchProducts(args, context)));
  server.registerTool('get_product', {
    description: `Get product details, variants, public online ${currency} offers in ${name}, delivery availability and available-store count. `
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
      + 'Partial failures remain explicit. Product checked_at values retain their original retrieval times.',
    inputSchema: productBatchInput, outputSchema: comparisonResultSchema, annotations,
  }, handleTool((args: z.input<typeof productBatchInput>, context) => compareProducts(client, args, context)));
  server.registerTool('find_common_stores', {
    description: `Find stores for one to ten unique product variants in ${name}, optionally filtered by city. `
      + 'all_in_stock requires explicit inStock for every requested product. Missing observations and failures remain unknown. '
      + 'Pickup text is separate from stock; quantities and branch prices are unknown.',
    inputSchema: commonStoresInput, outputSchema: commonStoresResultSchema, annotations,
  }, handleTool((args: z.input<typeof commonStoresInput>, context) => findCommonStores(client, args, context)));
  return server;
}
