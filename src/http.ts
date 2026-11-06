import { createServer as createNodeServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './server.js';
import { SuperzooClient } from './client.js';
import { readConfig } from './config.js';
import type { RuntimeConfig } from './config.js';

const MAX_BODY_BYTES = 64 * 1024;

function readJson(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        request.pause();
        reject(Object.assign(new Error('Request body exceeds 64 KiB'), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    request.once('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    request.once('error', reject);
    request.once('aborted', () => reject(new Error('Request aborted')));
  });
}

export function createHttpServer({ config = readConfig(), client = new SuperzooClient({ country: config.country }) }: { config?: RuntimeConfig; client?: SuperzooClient } = {}) {
  const server = createNodeServer(async (request, response) => {
    const reply = (status: number, message: string) => {
      response.writeHead(status, { 'Content-Type': 'application/json', ...(status >= 400 ? { Connection: 'close' } : {}) });
      response.end(JSON.stringify({ error: message }));
    };
    try {
      const authority = new URL(`http://${request.headers.host ?? ''}`);
      const host = authority.hostname.replace(/^\[([^\]]+)\]$/, '$1');
      if (authority.username || authority.password || !config.allowedHosts.includes(host)) return reply(403, 'Host not allowed');
      const origin = request.headers.origin;
      if (origin && !config.allowedOrigins.includes(origin)) return reply(403, 'Origin not allowed');
      if (origin) {
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Vary', 'Origin');
        response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, MCP-Protocol-Version');
        response.setHeader('Access-Control-Expose-Headers', 'MCP-Protocol-Version');
      }
      if (request.url === '/health' && request.method === 'GET') {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ status: 'ok', country: config.country }));
        return;
      }
      if (request.url !== '/mcp') return reply(404, 'Not found');
      if (request.method === 'OPTIONS') { response.writeHead(204).end(); return; }
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST, OPTIONS');
        return reply(405, 'Stateless MCP accepts POST requests');
      }
      if (request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
        return reply(415, 'Content-Type must be application/json');
      }
      if (Number(request.headers['content-length']) > MAX_BODY_BYTES) return reply(413, 'Request body exceeds 64 KiB');
      const body = await readJson(request);
      // Stateless transport: each request gets its own MCP instance. No session map or shared protocol state.
      const mcp = createServer(client);
      const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
      const cleanup = () => { void mcp.close().catch(() => {}); };
      response.once('close', cleanup);
      await mcp.connect(transport);
      await transport.handleRequest(request, response, body);
    } catch (error) {
      const status = error instanceof Error && 'status' in error && typeof error.status === 'number' ? error.status : 400;
      const message = error instanceof Error && 'status' in error ? error.message : 'Invalid HTTP request';
      if (!response.headersSent && !response.destroyed) reply(status, message);
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.maxHeadersCount = 50;
  return server;
}
