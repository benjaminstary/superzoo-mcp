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

- [ ] Trace animal-category navigation and the parameter filter view model and query. Start at Hermes `#15658`, `#15684`, `#15704`, and `#15708`. Identify the category and facet identifiers and confirm that the calls are public reads with the user ID omitted.
- [ ] Verify one animal category and one facet, such as life stage, for each supported market. Compare filtered results with the category-only response. Check whether a second page returns distinct IDs. Determine how filtered results honor product-sale and market price-level exclusions.
- [ ] Record category and facet discovery, pagination, and exclusion behavior. Task 5 requires a verified way to discover the IDs, apply the filter, and preserve the existing market restrictions.

## Task 5 — Implement verified category browsing

**Files:** `src/client.ts`, `src/contracts.ts`, `src/server.ts`, `test/client.test.js`, `test/server.test.js`, `README.md`, `CHANGELOG.md`.

**Proposed interface:** `list_product_categories({})` returns public category IDs and names. `browse_products({ category_id, facets?, page?, limit? })` returns public product summaries with provenance and coverage. Publish facet discovery through the category result or a category-scoped lookup according to Task 4. Include pagination only where verified. Start with one verified facet and preserve the current search tool.

- [ ] Add failing offline tests for category discovery, valid facet selection, forbidden and market-restricted products, malformed input, and empty results. If pagination ships, test first-page defaults, stable request parameters, and bounded coverage. Assert the tools are listed only in markets verified for their respective routes.
- [ ] Run `npm run build && node --test test/client.test.js test/server.test.js` and confirm failures for the new behavior.
- [ ] Add the client methods and output schemas for the verified inputs and response shapes. Reuse product exclusion logic where the upstream fields support it, or use the equivalent restrictions verified in Task 4. Register the tools and preserve shared request limits.
- [ ] Rerun the focused tests and typecheck. Document supported markets, facet discovery, and coverage in the README and changelog.

## Task 6 — Verify public shipping quotes and pickup points

**Files:** `docs/investigation.md`.

- [ ] Trace the product shipping calculator and pickup-point lookup, starting at Hermes `#15444`, `#15447`, and `#59233`. Confirm from the call path that a quote request only reads options. Record required inputs, the route's official origin, and any cart, account, or reservation dependency before probing.
- [ ] For each candidate market, verify one anonymous quote for a public product ID and the least precise location required by the route. Check currency, method identifiers, availability, timing semantics, and whether pickup points can be listed without checkout state. If the route requires account or checkout state, record the dependency and stop that branch.
- [ ] Record response shapes and supported inputs. Task 7 requires at least one verified anonymous product quote. Record an independently verified pickup-point listing as a follow-up.

## Task 7 — Implement verified delivery options

**Files:** `src/client.ts`, `src/contracts.ts`, `src/server.ts`, `test/client.test.js`, `test/server.test.js`, `README.md`, `CHANGELOG.md`.

**Proposed interface:** `get_delivery_options({ product_id, postal_code? })` for a verified product quote. Expose `postal_code` only if the route supports it and require it when upstream requires it. Return `market`, `source`, `checked_at`, `product_id`, and verified methods with nullable quoted cost and timing. Include pickup points when the verified response associates them with a method. A standalone pickup-point tool is a separate scope decision.

- [ ] Add failing offline tests for required location input, unknown quote values, decimal currency amounts, empty method lists, unavailable responses, and market-specific tool discovery. Check that the request logging omits postal codes.
- [ ] Run `npm run build && node --test test/client.test.js test/server.test.js` and confirm failures for the new behavior.
- [ ] Implement the supported method through the shared request policy. Preserve upstream quote wording and keep unknown values nullable.
- [ ] Rerun the focused tests and typecheck. Document supported markets, required inputs, and quote limitations in the README and changelog.

## Task 8 — Record smaller leads and verify the delivered release

**Files:** `docs/investigation.md`, `README.md`, `CHANGELOG.md`.

- [ ] Record feeding tables (Hermes `#15680`, `#59200`) and autocomplete (`#15428`) as separate follow-ups. Feeding tables need a verified anonymous response and clear manufacturer attribution. Autocomplete needs an anonymous response shape and a client that benefits from suggestions. Record exact EAN lookup as unverified after the HTTP 403 probe. Existing `get_product` already returns EAN.
- [ ] Review documented contracts and examples against actual tool discovery and results. Check that shipped features claim only supported markets and that deferred features have a concrete reason.
- [ ] Run `npm run typecheck`, `npm test`, `npm run test:package`, and `npm pack --dry-run`. Verify that the pack excludes APKs and research data. Run live smoke checks only for eligible public flows and record their outcomes separately from deterministic tests.
- [ ] Record completed tasks, failed evidence gates, and the status of each proposed feature. Stop after recording the results.
