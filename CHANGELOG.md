# Changelog

All notable changes to Superzoo MCP are documented here. Changes under
Unreleased are merged but have not been included in a published release.

## [0.2.0] - 2026-11-08

### Added

- `compare_products` compares up to ten unique product variants, preserving input
  order, conditional offers, observation timestamps, and per-product errors.
- `find_common_stores` matches stores by stable IDs across up to ten product
  variants. It reports all products in stock only when every product has explicit
  `inStock` status; missing observations remain unknown.
- Search filters for exact brand names, ignoring case and accents; inclusive
  decimal-string price bounds; and verified online delivery availability.
  Filtering scans at most 200 upstream candidates and reports bounded coverage.
- Success schemas for all five MCP tools, stable JSON tool errors, and bounded
  diagnostics on stderr.
- Daily and manual live smoke checks for Slovakia, Czechia, and Poland, separate
  from routine CI.
- Installed-package executable checks on Node.js 22 and 24, plus regression tests
  for cancellation and graceful shutdown.

### Changed

- All tools share a limit of four active upstream operations and 128 queued
  operations. A 15-second deadline covers queueing, retries, and response validation.
- Retry network failures and HTTP 429, 502, 503, and 504 responses once, honoring
  valid `Retry-After` values within the original deadline.
- Duplicate product and availability lookups share upstream work while retaining
  independent caller cancellation. A shared 256-entry LRU cache keeps validated
  product details for 60 seconds and raw store availability for 15 seconds,
  preserving original observation timestamps.
- Forward MCP cancellation and HTTP disconnects to upstream work without
  cancelling another caller's shared lookup.

### Fixed

- Forced HTTP shutdown cancels active and queued operations together before
  closing sockets, preventing queued requests from starting during cancellation.
  The five-second grace period still allows completing HTTP responses to drain.

## [0.1.0] - 2026-11-06

### Added

- Initial read-only MCP server for Super zoo in Slovakia, Czechia, and Poland.
- `search_products`, `get_product`, and `get_product_availability` tools for
  product discovery, public online prices, and store availability.
- Stdio and stateless Streamable HTTP transports, with Node.js 22 or newer required.
- HTTP Host and Origin validation, request body limits, loopback defaults, and
  configurable allowed hosts and origins.
- Docker support, offline tests, live smoke checks, and npm publishing through
  stable GitHub releases.

[Unreleased]: https://github.com/benjaminstary/superzoo-mcp/compare/v0.2.0...master
[0.2.0]: https://github.com/benjaminstary/superzoo-mcp/releases/tag/v0.2.0
[0.1.0]: https://github.com/benjaminstary/superzoo-mcp/releases/tag/v0.1.0
