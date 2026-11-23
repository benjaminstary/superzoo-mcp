# Superzoo MCP Shopping Feature Follow-ups Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans`. Complete one task per turn. Record the result and check off completed steps in this file. Stop after each task or when an upstream failure blocks it. Resume when the user asks to continue.

**Goal:** Quote shipping for multiple units, browse by pet needs, read manufacturer feeding tables, and identify a product variant from a barcode where the upstream API supports each feature.

**Architecture:** Extend the existing shipping tool first. Use separate evidence and implementation tasks for new upstream behavior. Put verified requests in the existing Superzoo client and expose them through the existing MCP schemas and handlers.

**Tech stack:** Node.js 22+, TypeScript, native `fetch`, Zod, MCP SDK, and `node:test`.

**Spec and evidence:** [Current tool contracts](../../../README.md#tools), [shipping quote findings](../../investigation.md#anonymous-product-shipping-quotes-and-pickup--2026-11-23), [category browsing task](2026-11-23-apk-inspired-mcp-features.md#task-5--implement-verified-category-browsing), and [feeding table and EAN findings](../../investigation.md#apk-feature-follow-ups--2026-11-23).

## Global constraints

- Keep tools anonymous, read-only, and usable from plain JavaScript. Verify each feature separately for SK, CZ, and PL before advertising market support.
- Use existing request limits, cancellation, validation, and MCP error handling. Preserve current tool inputs and defaults, currency and price eligibility, and source timestamps.
- Use public sample products and official endpoints. Probe sequentially with a deadline and redirect blocking. Record only reduced evidence and the minimal fixture needed for deterministic tests.
- If an evidence gate fails, record the HTTP status or missing contract and leave the dependent implementation checkboxes open. Advance to another feature only on the next user request. A new finding can reopen the blocked gate.
- Pickup-method metadata and autocomplete stay in the existing investigation backlog. This plan covers the four prioritized features.

## File map

| File | Responsibility |
| --- | --- |
| `docs/investigation.md` | Track route provenance, probe results, market support, and response limits. |
| `src/client.ts`, `src/config.ts` | Validate upstream shapes, preserve request policy, and configure verified markets. |
| `src/contracts.ts`, `src/server.ts` | Publish input and output contracts, advertise supported tools, and forward cancellation. |
| `test/client.test.js`, `test/contracts.test.js`, `test/server.test.js` | Test request bodies, response mapping, schemas, and market-specific discovery. |
| `README.md`, `CHANGELOG.md` | Document shipped behavior and supported markets. |

## Review focus

- An omitted shipment quantity retains the one-unit behavior. An echoed quantity or product mismatch fails validation. (Task 2)
- A market with single-unit support keeps its existing tool and schema. (Task 2)
- Category navigation IDs and filter scope IDs can differ. Product exclusions still apply. (Tasks 3–4)
- Feeding table amounts require source, units, and manufacturer attribution. Missing data leaves the guidance unavailable. (Task 5)
- Barcodes preserve leading zeroes. A close match or an ambiguous result cannot identify a variant. (Task 6)

## Task 1 — Verify multi-unit delivery quotes

**Files:** `docs/investigation.md`, this plan.

- [x] Reuse the verified one-unit captures for SK and CZ as a baseline. Send one anonymous quote for product `294-101115` and `quantity: 2` per market using that market's existing `deliveryQuoteWebId`.
- [x] Check that the shipment item and any top-level quote item echo the requested product and quantity. Record currency, price qualifiers, dates, and whether unavailable or empty methods remain distinguishable. An unchanged price can be valid if the response confirms two units.
- [x] Record supported markets and the tested range. A verified two-unit quote permits a maximum of `2` for the first implementation. Expand the bound only after separate verification. If neither market passes, defer Task 2 and stop.

**Result:** SK and CZ both returned HTTP 200 with the requested product and quantity in both item lists. Task 2 can support quantities `1` and `2` in both markets. [Probe results](../../investigation.md#two-unit-delivery-quotes--2026-11-23)

## Task 2 — Extend `get_delivery_options`

**Files:** `src/client.ts`, `src/contracts.ts`, `src/server.ts`, `src/config.ts` if markets differ, `test/client.test.js`, `test/contracts.test.js`, `test/server.test.js`, `README.md`, `CHANGELOG.md`.

**Contract:** `get_delivery_options({ product_id, quantity? })` supports `quantity` as an integer from `1` through the verified maximum in eligible markets. Default to `1` and add `quantity` to the result schema for all existing delivery markets. Keep existing single-unit discovery and input validation in a market where the wider range remains unverified.

- [x] Add tests for the omitted quantity, the two-unit request body and matching response, rejection of `0`, `1.5`, `"2"`, and values above the maximum, and `invalid_response` for a mismatched quantity or product in either item list. Test market discovery and verify an unsupported explicit quantity fails before any upstream request.
- [x] Run `npm run build && node --test test/client.test.js test/contracts.test.js test/server.test.js`. Confirm the new quantity assertions fail against the current one-unit implementation.
- [x] Extend `SuperzooClient.getDeliveryOptions` and the tool schema. Reuse the quote endpoint, require a single echoed item per supplied list, and compare both product ID and quantity. Preserve decimal prices, dates, and pickup mappings.
- [x] Rerun the focused tests and `npm run typecheck`. Update the README example and Unreleased changelog. Document market-level shipping quotes for multiple units of one variant.

**Result:** `quantity` is optional and defaults to `1` in SK and CZ. The quote reports the validated quantity. All 70 focused tests and all 142 suite tests passed, along with typecheck. The full suite ran with localhost access for its HTTP tests.

## Task 3 — Recheck category filter evidence

**Files:** `docs/investigation.md`, this plan, and the existing category plan if the gate opens.

- [x] Review the prior SK descriptor and CZ filter failures. Record new route documentation, a newly verified app request, or upstream recovery evidence before repeating either failed call. If no new evidence exists, leave the prior task deferred and stop.
- [x] In one candidate market, trace a navigation entry through its filter scope. Verify discovery of one category facet and its allowed values. Capture one successful unfiltered and one successful filtered response using that value. Check product identity, price-level restrictions, forbidden-product handling, and returned coverage.
- [x] Record the market, category ID mapping, facet contract, and reduced fixture. Keep pagination deferred unless a second-page request establishes it. Open Task 4 only if the category, facet, and eligibility checks pass in the same market.

**Result:** Complete. The anonymous Czech route lookup resolved the dog-food category scope. The APK-shaped request returned 784 matches. Applying `stari-psa=senior` returned 222, and all 10 first-page products carried that value. Both pages joined to 19 distinct published products with explicit sale restrictions and Czech level-1 prices. Task 4 can start with this category and facet. [Live evidence and reduced fixture](../../investigation.md#verified-czech-dog-food-category-filter--2026-11-23)

## Task 4 — Ship verified category browsing

**Files and interface:** Reuse [Task 5 of the APK plan](2026-11-23-apk-inspired-mcp-features.md#task-5--implement-verified-category-browsing). Start with `list_product_categories({})` and `browse_products({ category_id, facets? })`. Publish the verified facet keys and allowed values with their category. Initial browsing returns the first verified page with explicit coverage.

**Verified scope:** Czech `Granule pro psy`, facet `stari-psa` with `dospely`, `senior`, and `stene` advertised. Use the product read model to verify identity, publication, sale restrictions, and level-1 price presence. Treat the upstream total as pre-validation coverage. [Request and response evidence](../../investigation.md#verified-czech-dog-food-category-filter--2026-11-23)

- [x] Run the linked task's test-first implementation and verification steps for the supported market. Include a test that forwards the verified filter scope ID when it differs from the navigation ID, and a test that an unknown facet value triggers no request.
- [x] Record the market and supported facets in the README and Unreleased changelog. Update both plans with the result.

**Result:** Complete. Czech discovery returns the verified category and dog-age values from configuration. Browsing validates the first page and returns eligible summaries in filter order, with an upstream total and separate page counts. Missing, mismatched, and duplicate joined records yield `invalid_response`. Six new tests failed before implementation. All 76 focused tests, all 148 suite tests, and typecheck passed. Offline replay returned 10 eligible products from each saved Czech page, with upstream totals of 784 unfiltered and 222 for `senior`.

- [x] Extend the same tools to Slovakia after verifying its category, facet, and local price eligibility. Both saved Slovak pages returned 10 eligible summaries in replay, with upstream totals of 924 unfiltered and 238 for `senior`. Both Czech replays, typecheck, 149 suite tests, and the installed-package smoke test passed. [Slovak evidence](../../investigation.md#slovak-dry-dog-food-category-filter--2026-11-23)

**Current coverage:** Dry dog food in SK and CZ, one dog-age facet per market, and up to ten candidates from the first page. The tools support a shortlist. Broader category and facet coverage and paging are tracked in [Task 8](#task-8--verify-broader-category-browsing).

## Task 5 — Verify and expose manufacturer feeding tables

**Status:** Blocked on manufacturer attribution. Anonymous SK and CZ requests returned a table for one variant and an explicit null for another. The table response identifies the variant through the request path and omits the manufacturer and table provenance. [Probe notes](../../investigation.md#feeding-table-verification--2026-11-23)

**Files:** `docs/investigation.md`, this plan, and the shared client, contract, server, test, and user-facing files if verified.

- [ ] Start with saved Hermes references `#15680` and `#59200`. Establish the official anonymous request and verify one labelled table for a known food variant and one response for a variant without a table. Record how the response ties the table to the product and its manufacturer, plus the actual headings, amounts, and units. If any required evidence is missing, record the blocker and stop.
- [ ] Define `get_feeding_table({ product_id })` for verified markets. Record the supported response shape from the probe before implementation. Include `product_id`, `market`, `source`, `checked_at`, and a nullable table that preserves manufacturer attribution, headings, units, and values as published.
- [ ] Add offline tests for source values, absent table, identity mismatch where echoed, missing attribution or units, and discovery by market. Run `npm run build && node --test test/client.test.js test/contracts.test.js test/server.test.js` and confirm the new tests fail.
- [ ] Implement the tool through the shared client and request policy. Return published guidance without extrapolating quantities. Rerun the focused tests and typecheck. Update the README and Unreleased changelog.

## Task 6 — Verify and expose exact barcode lookup

**Status:** Blocked on anonymous access. The saved APK trace identifies the product read-model filter used by the scanner. The earlier anonymous exact EAN probe returned HTTP 403, and this review found no alternate route for an exact lookup. [Investigation notes](../../investigation.md#exact-barcode-lookup-verification)

**Files:** `docs/investigation.md`, this plan, and the shared client, contract, server, test, and user-facing files if verified.

- [ ] Find a supported anonymous lookup route. The prior exact EAN probe returned HTTP 403. If no supported route is established, record the blocker and stop this task.
- [ ] Verify lookup of an EAN from an existing product detail response. Confirm the result resolves the same variant with exact EAN equality. Verify no-match behavior with a valid unmatched test barcode. Document supported barcode lengths and market coverage.
- [ ] Define `lookup_product_by_ean({ ean })` for verified markets. Accept a digit string of a verified length with a valid EAN check digit. Return the existing product result for one exact, eligible variant. Use `not_found` for zero exact matches and `invalid_response` for multiple distinct exact variants.
- [ ] Add offline tests for leading-zero input, invalid checksums, nearby matches, duplicate variant IDs, distinct exact variants, exclusions, and market discovery. Run the focused client, contract, and server tests and confirm the new assertions fail.
- [ ] Implement exact matching through the shared request policy. Reuse existing product detail mapping and verified eligibility checks. Rerun the focused tests and typecheck. Update the README and Unreleased changelog.

## Task 7 — Verify shipped follow-ups

**Files:** This plan, `docs/investigation.md`, `README.md`, `CHANGELOG.md`.

- [x] For any implemented feature, check tool discovery, output schemas, and docs in all three markets. Confirm single-unit examples still work and record any features deferred by upstream behavior.
- [x] Run `npm run typecheck`, `npm test`, `npm run test:package`, and `npm pack --dry-run`. Confirm the package contains the runtime, metadata, README, and license. Record command results and any separate live verification.

**Result:** Typecheck passed, all 149 tests passed, the packed consumer executable passed its install and MCP smoke test, and the npm dry run listed 13 files. The release gate covers two-unit delivery quotes and first-page dry dog food browsing in SK and CZ. PL tool discovery excludes both features. [Verification record](../../investigation.md#shopping-follow-up-release-check--2026-11-23)

## Task 8 — Verify broader category browsing

**Status:** Blocked on live filter access. A single-alias lookup resolved the Slovak cat litter scope after the earlier route batch returned HTTP 403. The first filter request for that scope returned HTTP 403. Additional category facets, combined filtering, and paging still need live verification. [Probe notes](../../investigation.md#broader-category-browsing--2026-11-23)

- [ ] Trace navigation-to-scope resolution for several additional categories and verify which facet keys and values each category exposes. Verify a representative combined filter where a category exposes multiple facets.
- [ ] Verify a second page with the same category, filters, and sort. Check product ordering, overlap between pages, eligibility checks, and how the upstream API signals the final page.
- [ ] Record the verified markets, categories, facet discovery behavior, and paging limits. Use that evidence to scope an implementation of broader browsing through the existing tools.
