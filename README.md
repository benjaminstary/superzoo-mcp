# Superzoo MCP

An unofficial, read-only [Model Context Protocol](https://modelcontextprotocol.io/) server for finding Super zoo products, prices, and store availability. Supports **Slovakia, Czechia, and Poland**, over **stdio or Streamable HTTP**. No Super zoo account is required.

Strict TypeScript compiled to JavaScript. Requires Node.js 22 or newer. [MIT licensed](LICENSE). This project is not affiliated with Super zoo or the Plaček Group.

## Quick start

Clone this repository, then run:

```sh
npm ci
npm run build
npm start
```

The default is stdio with the Slovak shop. It waits for an MCP client rather than showing an interactive prompt.

### Stdio client configuration

Replace the script path with your checkout's absolute path. Some desktop clients also require the absolute path to Node.

```json
{
  "mcpServers": {
    "superzoo": {
      "command": "node",
      "args": ["/path/to/superzoo-mcp/dist/index.js"],
      "env": {
        "SUPERZOO_COUNTRY": "SK",
        "SUPERZOO_TRANSPORT": "stdio"
      }
    }
  }
}
```

### HTTP

```sh
SUPERZOO_COUNTRY=CZ SUPERZOO_TRANSPORT=http npm start
```

Connect an MCP client to **`http://127.0.0.1:3000/mcp`**. For clients that support URL configuration:

```json
{
  "mcpServers": {
    "superzoo": {
      "url": "http://127.0.0.1:3000/mcp"
    }
  }
}
```

HTTP uses stateless MCP Streamable HTTP with JSON responses. Each request gets a fresh protocol instance; there are no persistent sessions, standalone GET streams, or legacy SSE endpoint. `GET /health` checks process health and reports the selected country; it does not test upstream availability.

**No bearer token is required or implemented.** For remote access, place the service behind a TLS reverse proxy with access control and request limits. For example, Pocket ID can supply login for an OIDC-aware proxy. Verify your MCP client supports that authentication flow. The backend must remain reachable only through the proxy. See [SECURITY.md](SECURITY.md).

The server validates Host headers and rejects browser Origin headers unless explicitly allowed. For a reverse proxy that forwards `Host: mcp.example.com`:

```sh
SUPERZOO_TRANSPORT=http \
SUPERZOO_HOST=0.0.0.0 \
SUPERZOO_ALLOWED_HOSTS=mcp.example.com \
node dist/index.js
```

Set `SUPERZOO_ALLOWED_ORIGINS=https://client.example.com` only when a browser client needs CORS. Origin and Host checks do not authenticate clients. Non-browser MCP clients normally send no Origin header.

## Countries and configuration

One server instance serves one country. Start separate instances to use multiple markets simultaneously. Product IDs may exist across markets; prices and availability always come from the selected shop.

| `SUPERZOO_COUNTRY` | Shop | Language | Currency |
| --- | --- | --- | --- |
| `SK` (default) | [superzoo.sk](https://www.superzoo.sk/) | Slovak | EUR |
| `CZ` | [superzoo.cz](https://www.superzoo.cz/) | Czech | CZK |
| `PL` | [superzoo.com.pl](https://superzoo.com.pl/) | Polish | PLN |

These are the verified Super zoo storefronts. Other brands within the parent group, such as Dino Zoo, are outside this project's current scope. Unsupported country codes fail at startup; the server never falls back silently to a different market.

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `SUPERZOO_COUNTRY` | `SK` | `SK`, `CZ`, or `PL`, case-insensitive |
| `SUPERZOO_TRANSPORT` | `stdio` | `stdio` or `http` |
| `SUPERZOO_HOST` | `127.0.0.1` | HTTP bind hostname or IP |
| `SUPERZOO_PORT` | `3000` | HTTP port, 1–65535 |
| `SUPERZOO_ALLOWED_HOSTS` | Loopback names/IPs plus a specific bind host | Comma-separated accepted HTTP hostnames/IPs, without port or scheme. Binding `0.0.0.0` does not allow arbitrary hosts. |
| `SUPERZOO_ALLOWED_ORIGINS` | Empty | Comma-separated exact HTTP(S) browser origins; no wildcards |

Environment variables work with both transports. For Windows or file-based configuration, copy `.env.example` to `.env` and run:

```sh
node --env-file=.env dist/index.js
```

The server does not load `.env` automatically. Startup diagnostics go to stderr; stdout is reserved for MCP in stdio mode.

## Tools

| Tool | Arguments | Returns |
| --- | --- | --- |
| `search_products` | `query`, optional `limit` (default 10, max 50) | Product IDs, links, price offers, variants, and availability summaries |
| `get_product` | `product_id` | Product identity, brand, EAN, variants, price offer, delivery and available-store count |
| `get_product_availability` | `product_id`, optional `city` | Store names, addresses, links, opening hours, stock status and pickup text |

Example workflow:

1. `search_products({"query":"brit care lososovy olej","limit":3})`
2. Choose the correct bottle size using its variant-specific product ID.
3. `get_product_availability({"product_id":"294-101115","city":"Bratislava"})`

Ask your assistant: “Find Brit Care salmon oil and tell me which Bratislava stores have the 250 ml bottle.” For CZ or PL, select that market at startup and use a relevant city or omit the city filter.

## Prices, stock, and limits

- Prices come from anonymous online lookups in the market's currency. Decimal amounts remain strings. `price.context` is `public_online`; `price.variant` preserves the upstream offer label. **A `familyPrice` offer can appear without login and may require membership.** It is not proof of your eligibility or a physical-store price. `original_amount` and `lowest_amount` preserve upstream reference prices when present.
- Stock is a status, not an exact quantity. `quantity` is always `null`; missing stock status becomes `unknown`. Stock status and `pickup_text` stay separate: an in-stock product may only be ready tomorrow.
- Every successful result includes `market`, `source`, and an ISO `checked_at` timestamp. Prices and stock can change afterward. Results are fetched without a local cache and never reserve products.
- City filtering matches store names and addresses locally, ignoring case and accents. It does not measure distance or establish municipal boundaries. Pickup text remains in the shop's language.
- `opening_hours_html` contains upstream HTML. Treat it as untrusted data in any UI.
- Search checks at most 200 mixed candidates and filters non-products, forbidden products, and price restrictions. The verified default levels are SK `22` and CZ `1`. The Polish default level is unverified, so PL conservatively excludes any candidate with explicit price-level restrictions. This may omit eligible products.
- `upstream_total_count` is not a product count. `candidate_limit_reached` signals that upstream candidates were omitted. Fewer than the requested number may be returned.
- Search enriches up to four products concurrently per call. Partial failures retain discovery data with `price: null` and `detail_error`. Other failures return MCP tool errors. Each upstream request times out after 15 seconds; large searches may need a longer client timeout.
- HTTP request bodies are limited to 64 KiB. Remote request limits and authentication belong to your deployment infrastructure.
- These are undocumented upstream APIs. They may change. There are no account, cart, ordering, or mutation tools.

## Docker

```sh
docker build -t superzoo-mcp .
docker run --rm -p 127.0.0.1:3000:3000 -e SUPERZOO_COUNTRY=PL superzoo-mcp
```

A separate build stage compiles TypeScript. The final image contains production dependencies and compiled JavaScript, and runs HTTP as a non-root user. For a proxy, connect it through a private container network and set `SUPERZOO_ALLOWED_HOSTS` to the forwarded hostname. Avoid publishing the backend directly on a public interface.

## Development and validation

```sh
npm ci
npm run typecheck
npm test
SUPERZOO_COUNTRY=SK npm run smoke
SUPERZOO_COUNTRY=CZ npm run smoke
SUPERZOO_COUNTRY=PL npm run smoke
npm audit --omit=dev
npm pack --dry-run
```

The TypeScript runtime lives in `src/` and compiles to ignored `dist/` output. `npm test` builds first, then runs JavaScript tests against the compiled runtime. `npm run smoke` and `npm pack` also build automatically. After changing source, rebuild before using `npm start`. Installed packages and the final Docker image run compiled JavaScript without TypeScript development dependencies.

Unit and protocol tests use small public-data fixtures and temporary localhost HTTP listeners, without external requests. Each live smoke test makes three requests: search, product detail, and store availability. CI runs offline tests on Node.js 22 and 24. See [CONTRIBUTING.md](CONTRIBUTING.md) and [API notes](docs/investigation.md).

The npm package includes only compiled runtime JavaScript, README, license, and package metadata. The GitHub repository also contains tests and development files. Downloaded apps and raw research stay in ignored local storage and are not redistributed. Super zoo trademarks and third-party storefront content remain their owners' property.
