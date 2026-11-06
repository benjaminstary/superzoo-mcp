#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { SuperzooClient } from './client.js';
import { readConfig } from './config.js';
import { createHttpServer } from './http.js';

try {
  const config = readConfig();
  const client = new SuperzooClient({ country: config.country });
  if (config.transport === 'stdio') {
    const server = createServer(client);
    await server.connect(new StdioServerTransport());
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void server.close(); });
  } else {
    const server = createHttpServer({ config, client });
    server.on('error', error => { console.error(`Superzoo HTTP server error: ${error instanceof Error ? error.message : 'Unknown error'}`); process.exitCode = 1; });
    server.listen(config.port, config.host, () => {
      const host = config.host.includes(':') ? `[${config.host}]` : config.host;
      console.error(`Superzoo MCP (${config.country}) listening at http://${host}:${config.port}/mcp`);
    });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
      server.close();
      setTimeout(() => { server.closeAllConnections(); }, 5000).unref();
    });
  }
} catch (error) {
  console.error(`Superzoo MCP failed to start: ${error instanceof Error ? error.message : 'Unknown error'}`);
  process.exitCode = 1;
}
