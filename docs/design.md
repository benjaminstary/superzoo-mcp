# Design

The server exposes three read-only tools: product search, product detail, and per-store availability. A fixed market table selects the official storefront, search language, currency and sale restrictions. Country is fixed for the process lifetime; there is no arbitrary upstream URL input. SK is the default; CZ and PL are also verified.

The native-fetch API client owns encoding, response validation, timeouts and normalization. Public price offers retain their upstream variant label, including conditional family prices. Unknown stock and enrichment failures remain explicit. Search caps candidates at 200 and enriches up to four products at a time per search.

The same tools run over stdio or stateless MCP Streamable HTTP using the official SDK. A fresh MCP instance and transport handle each HTTP request, with no shared session state. Native Node HTTP validates Host/Origin, limits JSON body size and closes protocol instances when responses close. HTTP binds to loopback by default and has no application authentication. Remote TLS, authentication and request limits belong to deployment infrastructure, as requested.

Keep runtime source in strict TypeScript on Node.js 22+. Compile to `dist/` JavaScript for stdio, HTTP and the package executable. Infer upstream types from Zod validation and type market/configuration boundaries. Tests exercise compiled modules. Docker uses a separate compiler stage, so production only needs JavaScript and runtime dependencies. Native HTTP avoids adding another framework. Environment settings select the market, transport and listener; upstream hosts remain allowlisted in code. Fixtures are reduced public facts, not redistributed app code or copied product descriptions.

See README.md for the configuration and response contract, and investigation.md for API evidence and market limitations.
