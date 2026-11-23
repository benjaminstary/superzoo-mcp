# APK-Inspired Superzoo MCP Features Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. Complete one task per turn, verify it, update the checkboxes with results, and stop. Resume after the user asks to continue.

**Goal:** Help shoppers compare products, find nearby stores, browse by pet needs, and check delivery options using public Super zoo data.

**Architecture:** Extend the existing product details response first. For each new capability, verify anonymous behavior per market before designing the public tool. Route supported calls through the existing client and request policy and publish typed MCP results.

**Tech stack:** Node.js 22+, TypeScript, native fetch, Zod 4, MCP SDK, and `node:test`.

**Spec and evidence:** [Current API contract](../../../README.md#tools), [APK provenance](../../investigation.md#discovery-and-provenance), [product and price observations](../../investigation.md#evidence-and-implementation-implications), and the 2026-11-23 APK review. REA verified and extracted the XAPK under manifest `agm_ff9638962bc438ade370408a673e12af5c61703aa00c314ca3d94dae972a5494`. Full APK inspection timed out. Hermes v96 disassembly supplied the function references below. Five fresh anonymous probes, including three existing detail routes, returned HTTP 403. Task 1 uses earlier public captures. The later tasks require fresh evidence for each new route.

## Global constraints

- Keep the server anonymous, read-only, and usable from plain JavaScript. One market per process, with separate SK, CZ, and PL evidence. Keep account, loyalty, cart, reservation, and purchase flows outside this plan.
- Preserve existing fields, defaults, price eligibility labels, stock semantics, timestamps, and MCP error shape. Reuse the [shared request policy](../../../src/request.ts) and existing cancellation handling. The redirect retry finding remains tracked in Task 8 of the earlier local MCP enhancements plan.
- Use official origins verified for the selected market. Probe with bounded, sequential requests, deadlines, and redirect blocking. Use public sample IDs, public place coordinates, or test postal codes where applicable. Keep credentials, customer IDs, session data, exact locations, raw captures, and app artifacts out of committed fixtures and logs.
- Verify source, request shape, status, and selected response fields per market. Record the date, market, and evidence in `docs/investigation.md`. HTTP 403 or an ambiguous response stops work on that route for the affected market. Resume at the next evidence gate only when the user asks to continue.
- When an evidence task yields no supported markets, record the dependent implementation task as deferred with its reason. Leave its implementation checkboxes open.
- Write deterministic tests from reduced fixtures before changing runtime behavior. Run the focused checks and typecheck per runtime task, then ensure all existing protocol and package checks pass in the final task. Record the result and any deferred work in the checklist.

## File map

| File | Responsibility |
| --- | --- |
| `src/client.ts` | Validate upstream product data and use the shared request policy for supported routes. |
| `src/contracts.ts` | Publish additive product fields and schemas for verified tools. |
| `src/server.ts` | Describe tools, register schemas, and forward cancellation. |
| `test/client.test.js`, `test/contracts.test.js`, `test/server.test.js`, `test/shopping.test.js` | Check mapping, reuse, tool payloads, and error behavior. |
| `docs/investigation.md`, `README.md`, `CHANGELOG.md` | Record evidence, user-facing behavior, and shipped changes. |

## Review focus

- Malformed optional fields and legacy payloads preserve valid base product data (Task 1).
- Decimal strings, unit sizes, rating values, and conditional offer labels retain upstream meaning (Task 1).
- Store positions and IDs are verified before distance ranking or joining stock results (Task 3).
- Browse coverage stays explicit and respects the selected market's product exclusions (Task 5).
- Delivery results reflect the quoted product, market, and destination inputs. Quote failures produce an error (Task 7).

## Task 1 — Extend existing product details

**Files:** `src/client.ts`, `src/contracts.ts`, `src/server.ts`, `test/client.test.js`, `test/contracts.test.js`, `test/shopping.test.js`, `README.md`, `CHANGELOG.md`.

**Interface:** Extend `ProductResult` with `rating: { value: number, count: number } | null` and `attributes: { name: string, value: string }[]`. Extend a present `price` with `unit_price` and `original_unit_price`, each `{ amount: string, unit_size: string, unit: string } | null`. The rating value retains its upstream scale. Unit prices use the parent offer's currency, and current unit prices retain its eligibility context.

- [x] Add a fixture-backed test for `getProduct`: map a captured `rating: { rating: 90, ratingCount: 23 }` to `{ value: 90, count: 23 }`, preserve the localized attribute name and value, and map a Polish `{ unitPrice: "2.83", unitSize: "100", unit: "g" }` to `{ amount: "2.83", unit_size: "100", unit: "g" }`.
- [x] Add cases for absent fields, a malformed rating, mixed valid and malformed attributes, a missing unit, and zero or negative unit size. Assert that valid base data, attribute order, and other valid optional fields survive. Assert that an absent price still returns `price: null` and an existing `familyPrice` remains conditional.
- [x] Verify the comparison output carries the same fields and original per-product timestamps. Verify enriched search results validate under the shared product schema, while failed enrichment preserves the existing partial response.
- [x] Run `npm run build && node --test test/client.test.js test/contracts.test.js test/shopping.test.js`. Verify the new field assertions fail on the current code.
- [x] Extend `SuperzooClient.getProduct` using the current detail response. Read ratings from `rating`, localized attributes from `parameters`, and units from `price.sellUnitPrice` and `price.originalUnitPrice`. Validate these optional sections independently. Accept decimal strings and strictly positive unit sizes. Keep unit values as provided. Add the fields to `productResultSchema` and update the relevant MCP descriptions.
- [x] Run the focused command again and run `npm run typecheck`. Verify one upstream detail request with the existing cache behavior. Update the README and Unreleased changelog with field meanings and the rating-scale limitation.

**Verified:** Six tests failed on missing fields before implementation. After implementation, all 75 focused tests and all six MCP server tests passed. Typecheck and `git diff --check` passed. The comparison cache test confirmed a single upstream detail request and the original product timestamp. Tests used saved public evidence and local fixtures.

## Task 2 — Verify anonymous store locator behavior

**Files:** `docs/investigation.md`.

- [x] Trace the app's store filter, nearest-store request, and store detail lookup through their base URL and inputs. Start at Hermes `#15722`, `#15726`, and `#15730`. Distinguish actual store coordinates from user-supplied coordinates.
- [x] For each market with a traced official route, probe one known city or public coordinate. Record returned IDs, location fields, addresses, hours, and pagination. Compare IDs against saved stock observations for a known branch in that market. Record any market where coordinate order, units, coverage, or ID equivalence remains unknown.
- [x] Record the supported inputs and a reduced response example. Task 3 requires at least one verified public lookup and stable store IDs. Distance requires independently verified coordinates or documented response units. Joining stock results requires verified shared IDs.

**Verified:** SK and CZ each returned HTTP 200 and a single nearest branch with a store ID and public address. SK has one exact branch ID match in the response's related stores and the saved stock fixture. CZ stock ID equivalence and the PL locator remain unverified. Task 3 can proceed with coordinate-only nearest-store lookup in SK and CZ. City filtering, pagination, caller distance, and broader stock joins remain open. [Trace and probe evidence](../../investigation.md#anonymous-store-locator--2026-11-23)

## Task 3 — Implement the verified store locator

**Files:** `src/client.ts`, `src/config.ts`, `src/contracts.ts`, `src/request.ts`, `src/server.ts`, client and protocol tests, `README.md`, `CHANGELOG.md`.

**Verified interface:** `find_stores({ latitude, longitude })` for SK and CZ. Require both coordinates in decimal degrees and validate latitude to ±90 and longitude to ±180. Return `market`, `source`, `checked_at`, `coverage: "nearest_store"`, and up to one store with its ID, name, address, and nullable branch coordinates. City, limits, pagination, and caller distance remain deferred.

- [x] Add client and protocol tests for the anonymous request, required and bounded inputs, rejection of extra selectors, coverage, empty versus malformed responses, optional branch coordinates, and Polish tool discovery.
- [x] Run `npm run build && node --test test/client.test.js test/server.test.js` and confirm failures for the new behavior.
- [x] Implement `SuperzooClient.findStores` with the shared request policy, cancellation, and a fixed market-to-route mapping. Publish the success schema through `createServer` for SK and CZ. Document the verified Bratislava Central stock ID match and keep stock lookups in the existing tools.
- [x] Rerun the focused tests and typecheck. Update the README and changelog with supported markets and coverage.

**Verified:** Six tests failed before implementation. All 53 focused tests and all 134 tests in `npm test` passed afterward, along with typecheck and `git diff --check`. Offline fixtures use the Task 2 captures. An explicit `nearestStore: null` yields an empty list. An absent field or malformed branch identity yields `invalid_response`.

## Task 4 — Verify anonymous category browsing

**Files:** `docs/investigation.md`.

- [x] Trace animal-category navigation, filter request construction, and the facet view model. Confirm the anonymous call shape and identify the navigation ID and parameter alias fields. Concrete facet values remain unverified.
- [x] Run the bounded category-browsing probes. Anonymous navigation worked in SK and CZ. The SK descriptor and CZ product filter returned HTTP 500, closing those routes for this pass. Facet selection, pagination, and product exclusions remain unverified.
- [x] Record the evidence and limits. The end-to-end gate failed for all markets. [Category-browsing investigation](../../investigation.md#anonymous-category-browsing--2026-11-23)

## Task 5 — Implement verified category browsing

**Files:** `src/client.ts`, `src/contracts.ts`, `src/server.ts`, `test/client.test.js`, `test/server.test.js`, `README.md`, `CHANGELOG.md`.

**Complete for the Slovak and Czech dry dog food categories.** The shopping follow-up verified the navigation-to-scope mapping, local dog-age facet, and first-page results in each market. Browsing checks publication, sale restrictions, and local price-level eligibility through the product read model. Pagination, additional categories, and Poland remain deferred. [Czech evidence](../../investigation.md#verified-czech-dog-food-category-filter--2026-11-23) · [Slovak evidence](../../investigation.md#slovak-dry-dog-food-category-filter--2026-11-23)

**Proposed interface:** `list_product_categories({})` returns public category IDs and names. `browse_products({ category_id, facets?, page?, limit? })` returns public product summaries with provenance and coverage. Publish facet discovery through the category result or a category-scoped lookup according to Task 4. Include pagination only where verified. Start with one verified facet and preserve the current search tool.

- [x] Add failing offline tests for category discovery, valid facet selection, forbidden and market-restricted products, malformed input, and empty results. If pagination ships, test first-page defaults, stable request parameters, and bounded coverage. Assert the tools are listed only in markets verified for their respective routes.
- [x] Run `npm run build && node --test test/client.test.js test/server.test.js` and confirm failures for the new behavior.
- [x] Add the client methods and output schemas for the verified inputs and response shapes. Reuse product exclusion logic where the upstream fields support it, or use the equivalent restrictions verified in Task 4. Register the tools and preserve shared request limits.
- [x] Rerun the focused tests and typecheck. Document supported markets, facet discovery, and coverage in the README and changelog.

**Verified:** The tools are discoverable in SK and CZ. Browsing supports the first page of up to ten candidates with optional `vek-psa` in SK or `stari-psa` in CZ. Both saved pages per market passed the output schema in offline replay. Typecheck, 149 full-suite tests, and the installed-package smoke test passed. [Shopping follow-up Task 4](2026-11-23-shopping-feature-follow-ups.md#task-4--ship-verified-category-browsing)

Additional categories, category-specific facet discovery, and pagination are pending verification. [Shopping follow-up Task 8](2026-11-23-shopping-feature-follow-ups.md#task-8--verify-broader-category-browsing)

## Task 6 — Verify public shipping quotes and pickup points

**Files:** `docs/investigation.md`.

- [x] Trace the product shipping calculator and pickup-point lookup. The quote path reads options from the official logistics service with a market ID, product ID, and quantity. The checkout map requires basket and shipment state.
- [x] Verify one anonymous quote per candidate market. SK and CZ returned prices, dates, and associated store pickup places for one unit without location inputs. The direct pickup-place listing returned HTTP 401. The separate pickup-method catalog returned HTTP 200 in SK and CZ. PL remains unverified.
- [x] Record response shapes and supported inputs. SK and CZ meet the Task 7 gate. The pickup-method catalog is a follow-up. [Shipping investigation](../../investigation.md#anonymous-product-shipping-quotes-and-pickup--2026-11-23)

## Task 7 — Implement verified delivery options

**Files:** `src/client.ts`, `src/contracts.ts`, `src/server.ts`, `test/client.test.js`, `test/server.test.js`, `README.md`, `CHANGELOG.md`.

**Proposed interface:** `get_delivery_options({ product_id })` in SK and CZ quotes one unit at the market level. Return `market`, `source`, `checked_at`, `product_id`, and verified methods with nullable quoted cost and timing. Include pickup points supplied by the quote, preserving each method association. Destination-specific and standalone pickup-point lookup remain separate.

- [x] Add offline tests for the one-unit quote body, product identity, unknown quote values, decimal currency amounts, empty method lists, method-to-place associations, unavailable responses, and market-specific tool discovery.
- [x] Run `npm run build && node --test test/client.test.js test/server.test.js`. Six tests failed for the missing client method or tool registration.
- [x] Implement the quote through the shared request policy. Preserve localized method and place names, quoted dates with offset, and nullable price and availability values.
- [x] Rerun the focused tests and typecheck. Document supported markets, required inputs, and quote limitations in the README and changelog.

**Verified:** All 58 focused tests and 139 full-suite tests passed, along with typecheck, the package install smoke test, and `git diff --check`. Both saved Task 6 quotes passed the new output contract with 44 SK and 204 CZ store locations. Quote implementation made no live probes.

## Task 8 — Record smaller leads and verify the delivered release

**Files:** `docs/investigation.md`, `README.md`, `CHANGELOG.md`.

- [x] Record feeding tables (Hermes `#15680`, `#59200`) and autocomplete (`#15428`) as separate follow-ups. Feeding tables need a verified anonymous response and clear manufacturer attribution. Autocomplete needs an anonymous response shape and a client that benefits from suggestions. Record exact EAN lookup as unverified after the HTTP 403 probe. Existing `get_product` already returns EAN. [Follow-ups](../../investigation.md#apk-feature-follow-ups--2026-11-23)
- [x] Review documented contracts and examples against actual tool discovery and results. Check that shipped features claim only supported markets and that deferred features have a concrete reason. Discovery exposes seven tools in SK and CZ and five in PL. The final review corrected the Bratislava Central ID formatting in the README and updated the design notes to reflect shipped tools and unit prices.
- [x] Run `npm run typecheck`, `npm test`, `npm run test:package`, and `npm pack --dry-run`. Typecheck, all 139 deterministic tests, and the installed-package smoke passed. The dry run listed 13 entries containing runtime JavaScript, README, license, and package metadata. APKs and research data are excluded. All four eligible live calls passed. [Separate live results](../../investigation.md#apk-feature-release-smoke--2026-11-23)
- [x] Record completed tasks, failed evidence gates, and the status of each proposed feature. Stop after recording the results.

**Release status:** Tasks 1–4 and 6–8 are complete. The verified scope is recorded in the [v0.3.0 changelog](../../../CHANGELOG.md#030---2026-11-23).

| Feature | Status |
| --- | --- |
| Product enrichment | Available through existing product, enriched search, and comparison results in SK, CZ, and PL. Optional values depend on the detail response. |
| Nearest store | Available in SK and CZ with coordinates and up to one branch. PL, broader stock ID equivalence, caller distance, and pagination remain unverified. |
| Category browsing and facets | Deferred in v0.3.0 after HTTP 500 responses. The unreleased implementation uses the verified Slovak and Czech filter requests from the shopping follow-up. |
| Delivery quotes | Available in SK and CZ for one unit per quote, including supplied pickup places. PL and destination-specific availability remain unverified. Standalone pickup-place listing returned HTTP 401. The verified pickup-method catalog remains a follow-up. |
| Feeding tables, autocomplete, exact EAN lookup | Follow-ups with separate evidence requirements. The exact EAN probe returned HTTP 403. |
