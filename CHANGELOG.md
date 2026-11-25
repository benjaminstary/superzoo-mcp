# Changelog

All notable changes to Superzoo MCP are documented here. Changes under
Unreleased are merged but have not been included in a published release.

## [Unreleased]

## [0.5.1] - 2026-11-25

### Added

- A verified restock walkthrough for Slovakia and Czechia. It shows how to
  match exact pack sizes, check pickup timing for multiple products at the same
  branch, and request a delivery quote for two units of one variant.

### Changed

- MCP tool descriptions explain how to discover scoped brand and attribute
  filters, label Family member prices, and compare prices within the checked
  results using matching units. Tool inputs and outputs remain compatible.

## [0.5.0] - 2026-11-24

### Added

- Browse the Slovak and Czech catalogues across dogs, cats, small mammals,
  birds, aquariums, and terrariums. Filter by category, keyword, or both, and
  combine live catalogue facets with brand, price, stock, and sorting options.
  The same tools handle life stages for pet food and dimensions for aquarium
  decorations.
- `browse_products` can filter a page for advertised sales, Family member
  prices, or both in Slovakia and Czechia. Deal matches include the public
  offer amount, original amount, price variant, and published unit price
  when available. The Super zoo storefront provides these details anonymously.

### Changed

- **Breaking:** `list_product_categories({})` returns category navigation.
  Pass `category_id`, `query`, or both to discover the filters and valid values
  for that scope.
- `browse_products` verifies up to ten candidates per page. Follow `next_page`
  when present, including after an empty page. Keyword browsing checks up to 200
  upstream candidates.

## [0.4.0] - 2026-11-24

### Added

- `list_product_categories` and `browse_products` cover dry and wet dog food,
  dry cat food, and cat litter in Slovakia and Czechia. Food categories support
  life-stage filters, dry dog food also supports grain-free, and cat litter
  supports litter type. Browsing combines facets on the selected category,
  returns the next page when available, and reports upstream matches separately
  from eligible products on the page.
- Stable GitHub releases publish Docker images to GitHub Container Registry
  for `linux/amd64` and `linux/arm64`.

### Changed

- `get_delivery_options` accepts an optional `quantity` of 1 or 2 in Slovakia
  and Czechia and reports the quantity in the quote. The default is 1.

## [0.3.0] - 2026-11-23

### Added

- `get_delivery_options` quotes market-level shipping prices and dates for one
  unit of a product variant in Slovakia and Czechia, with any pickup places
  supplied by the quote.
- `find_stores` accepts latitude and longitude and returns up to one branch
  selected by Super zoo in Slovakia and Czechia.
- Product details, enriched search results, and comparisons in Slovakia,
  Czechia, and Poland include localized attributes, ratings on the upstream
  scale, and supplied current and original unit prices in the offer currency.

### Fixed

- Stdio cancellation stops upstream work for MCP requests with ID `0` or an
  empty string. Responses preserve the original request ID.
- Upstream smoke checks emit one bounded diagnostic per check on stderr.
- City-filtered common-store results retain all stock observations when the same
  store has different names or addresses across products.

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

[Unreleased]: https://github.com/benjaminstary/superzoo-mcp/compare/v0.5.1...master
[0.5.1]: https://github.com/benjaminstary/superzoo-mcp/releases/tag/v0.5.1
[0.5.0]: https://github.com/benjaminstary/superzoo-mcp/releases/tag/v0.5.0
[0.4.0]: https://github.com/benjaminstary/superzoo-mcp/releases/tag/v0.4.0
[0.3.0]: https://github.com/benjaminstary/superzoo-mcp/releases/tag/v0.3.0
[0.2.0]: https://github.com/benjaminstary/superzoo-mcp/releases/tag/v0.2.0
[0.1.0]: https://github.com/benjaminstary/superzoo-mcp/releases/tag/v0.1.0
