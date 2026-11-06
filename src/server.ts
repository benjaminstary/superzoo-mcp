import type { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { SuperzooClient, searchInput, productInput, availabilityInput } from './client.js';

function handleTool<Input>(run: (args: Input) => Promise<Record<string, unknown>>) {
  return async (args: Input): Promise<CallToolResult> => {
    try {
      const data = await run(args);
      return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : 'Superzoo request failed' }] };
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
      + 'Partial detail failures are marked on each product. Use variant-specific product IDs for stock lookups.',
    inputSchema: searchInput.shape, annotations,
  }, handleTool((args: z.input<typeof searchInput>) => client.searchProducts(args)));
  server.registerTool('get_product', {
    description: `Get product details, variants, public online ${currency} offers in ${name}, delivery availability and available-store count. `
      + 'Price variant identifies conditional offers such as familyPrice; membership eligibility and branch prices are not verified.',
    inputSchema: productInput.shape, annotations,
  }, handleTool((args: z.input<typeof productInput>) => client.getProduct(args)));
  server.registerTool('get_product_availability', {
    description: `Get availability in ${name} stores for one product variant. Optional city filters store name/address locally, ignoring accents. `
      + 'Stock status and pickup text are separate. No exact quantities or branch prices. Check checked_at for freshness.',
    inputSchema: availabilityInput.shape, annotations,
  }, handleTool((args: z.input<typeof availabilityInput>) => client.getProductAvailability(args)));
  return server;
}
