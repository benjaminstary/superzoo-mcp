# Shopping Response Clarity Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` for inline implementation or `superpowers:subagent-driven-development` if delegation is requested. Track progress with the checkboxes below.

**Goal.** Help MCP clients give shoppers a product page they can open, label Family prices correctly, and keep delivery estimates within the quote's coverage.

**Architecture.** Normalize the membership requirement where the server builds public prices. Expose the delivery quote's address coverage on the existing response. Reuse the existing product URLs and tell clients when to show them.

**Tech stack.** TypeScript, Zod, MCP SDK, and Node.js tests. The client-facing contract is plain JSON and works with vanilla JavaScript clients.

## Design

The current deployed MCP was tested in fresh Confer sessions. Confer preserved catalogue filters across pages on the repeat run, but it inferred stacked discounts from `topPriceFamilySale`. An earlier run treated a market-level express quote as confirmation of Wolt availability and timing in Šaľa. Use those transcripts as the baseline. Category-ID browsing remains a separate check because Confer used keyword browsing in both runs.

Successful `search_products` items, `get_product`, and `browse_products` already expose `url`. A successful `compare_products` item exposes `product.url`. These URLs are market-specific storefront pages built from the upstream product alias. Show the pack size alongside the link when confirmed. Failed comparisons have no product link, while partial search results can still carry the link supplied by discovery. Preserve the existing URL fields and use the supplied URL as-is.

## Constraints and review checks

- Add response fields without changing existing inputs, price amounts, URLs, paging, or offer eligibility. Preserve market support and use the existing upstream calls.
- `price.requires_membership` is `true` for `familyPrice` and `topPriceFamilySale`, `false` for the known `default` and `sale` variants, and `null` for missing or unrecognized variants. Preserve `price: null` when the price is absent. The field describes the returned price's membership requirement. Other conditions and shopper eligibility may still apply.
- `get_delivery_options` returns `address_checked: false`. It preserves method and pickup-place dates, availability flags, and fee qualifiers as supplied. An express option without a matching address is insufficient to confirm availability or an ETA for a given city. A listed pickup place can still be reported with its own availability and date, when supplied.
- Verify partial and nested product responses. Partial search items retain their URL and `price: null`. Successful comparisons retain `product.url` and the new field on `product.price` when a price exists.
- Verify that an empty quote and a quote with express or pickup data both carry the address coverage field. Preserve existing nulls, explicit false values, zero fees, and dates.

## Task 1 — Expose the membership requirement

**Files.** `src/client.ts`, `src/contracts.ts`, `src/server.ts`, `test/client.test.js`, `test/server.test.js`, `README.md`.

- [x] Extend the product detail test to check the six cases `familyPrice`, `topPriceFamilySale`, `sale`, `default`, `voucher`, and a missing variant, plus absent `price`. Assert the mappings above and that the raw variant is preserved. Extend the MCP catalogue offers test to check `true` on both Family variants and `false` on `sale` in `structuredContent`.
- [x] Run `npm run build && node --test test/client.test.js test/server.test.js`. The new assertions should fail on missing `price.requires_membership`.
- [x] Add `requires_membership` as a nullable Zod boolean to the shared public price schema. Derive it once in `publicPrice`. Have `browseProducts` use `price.requires_membership === true` for its Family classification, while retaining the existing `sale` check and the requirement for a lower price than `original_amount`.
- [x] Update the affected tool guidance and README to use the structured field for membership and preserve unknown variants as unknown. Run the same focused tests and confirm they pass.

## Task 2 — Expose the delivery quote's coverage

**Files.** `src/client.ts`, `src/contracts.ts`, `src/server.ts`, `test/client.test.js`, `test/server.test.js`, `README.md`.

- [x] Extend the existing delivery tests to assert `address_checked: false` for an ordinary quote, an empty valid quote, and the two-unit MCP structured response. Retain assertions for dates, pickup places, and quote request bodies.
- [x] Run `npm run build && node --test test/client.test.js test/server.test.js`. The new assertions should fail on missing `address_checked`.
- [x] Add `address_checked: z.literal(false)` to `deliveryOptionsResultSchema` and return it from `SuperzooClient.getDeliveryOptions`. Describe it in the tool and README as a single-variant market quote without an address or postal code. Instruct clients to report place-specific pickup data only for the place it describes.
- [x] Run the same focused tests and confirm they pass.

## Task 3 — Surface existing product links in client answers

**Files.** `src/server.ts`, `README.md`, `test/client.test.js`, `test/server.test.js`.

- [x] Add a short instruction to `search_products`, `get_product`, `browse_products`, and `compare_products` to link recommended products using the URL returned for the matching result. Mention the nested `product.url` for comparisons in the README. Preserve the distinction between a product page and the confirmed pack size.
- [x] Extend existing structured-response assertions where coverage is missing. Check a market-specific storefront link for detail, search, browse, and successful comparison. Check that partial search still links its candidate and a failed comparison still has `product: null`.
- [x] Run `npm run typecheck`, `npm test`, and `git diff --check`. Confirm that JSON responses expose the new fields and the same product URLs through the normal MCP entry points.

## Candidate validation in Confer

- [ ] Deploy the candidate to a test endpoint or package version and confirm the connected server is the candidate. Run the same baseline prompts in fresh sessions and save tool results and final answers for comparison.
- [ ] In the Šaľa test, the answer links both exact products, preserves the shared-pickup finding, and presents DPD as a quote for two units of the selected granules. It does not promise a Wolt ETA or address availability without evidence for that location.
- [ ] In the offers test, every listed offer links its product page. `topPriceFamilySale` and `familyPrice` are both labeled Family when returned, with no claim of stacked discounts. Subsequent pages use the same inputs with only `page` changed. The answer limits any ranking to the products checked.
- [ ] Run one separate category-ID prompt using the same scope for discovery and browsing. Capture `category_id`, `brands`, `facets`, `offer`, and `next_page` so this verifies category browsing independently of the keyword baseline.
