# Super zoo Exact-Product Restock Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans`. Steps use checkboxes to track completion.

**Goal** Help someone who knows the food or litter they buy find the exact pack, see where and when they can collect it, and check a delivery alternative.

**Architecture** Compose the existing MCP tools from a plain JavaScript client. Use the public storefront to check live results. Change the server only when a recorded failure identifies a gap in the existing contracts.

**Tech stack** Node.js 22+, JavaScript ESM, MCP SDK over stdio, existing TypeScript server, and `node:test`.

**Spec and evidence** [Current tool contracts](../../../README.md#tools), [pickup and delivery evidence](../../investigation.md#anonymous-product-shipping-quotes-and-pickup--2026-11-23), and [public offer evidence](../../investigation.md#public-deal-verification--2026-11-24).

## Scope

- Start with repeat food and litter purchases in SK and CZ. Run each scenario against one configured market. Preserve existing PL behavior.
- Keep the workflow anonymous, read-only, and usable without React. Use existing request limits and deadlines. Keep precise addresses, accounts, purchasing, and notifications outside the first release.
- Answer with the confirmed variant and pack, product link, online price and currency, Family terms where applicable, branch link and pickup text, and source check times. Include an available delivery method for the requested SKU and supported quantity when it helps the decision.
- Use public evidence and test scenarios to assess usefulness and correctness. Demand and repeat usage remain open questions until real usage data exists.

## Files

| Path | Responsibility |
| --- | --- |
| `docs/investigation.md` | Sample product links, storefront checks, scenario results, and evidence for any upstream gap. |
| `README.md` | Restock prompts and instructions for composing the existing tools. |
| `test/server.test.js` | Reuse the existing in-memory MCP harness for any missing regression coverage found in the replay. |
| `src/server.ts`, `src/shopping.ts`, `src/client.ts` | Inspect only for the first pass. If a reproducible gap needs runtime work, identify the responsible file and define its test before editing. |

## Execution outcome

The [live replay](../../investigation.md#exact-product-restock-replay--2026-11-25) verified exact pack identity, individual pickup estimates at shared branches, and a two-unit market-level delivery quote in both markets. The storefront-backed pickup labels supported a client workflow using existing per-product observations. The README recipe preserves the existing meaning of `all_in_stock`. The Slovak replay requested Universal 10 l after the search for Original returned no exact match.

## Task 1 — Build the shopper scenario set

- [x] Collect six public storefront samples, three per market. Use one dry food with adjacent pack sizes, one litter, and one product with a verified sale or Family offer per market. Record name, pack, variant ID, URL, and market. Use Bratislava and Praha as starting cities. Prices and stock are observations with timestamps.
- [x] Inspect public SK/CZ shopping discussions and one price comparison page per market. Save links to examples of recurring cost, exact pack selection, or pickup timing when present. Record what shoppers explicitly ask and which decision the storefront or comparison page already answers.
- [x] Write the prompts below in SK and CZ with sample names and pack sizes. Save the expected decision and the tool fields needed to justify it. Use existing offline fixtures for sparse states that live stock may not present during the run.

| Scenario | Expected decision |
| --- | --- |
| “Where can I pick up this exact food pack today?” | Confirm the requested variant. Show a city branch with the storefront's pickup timing, or report that same-day pickup could not be confirmed. |
| “Can I get this food and litter at one store?” | Show a shared pickup option only when both products have affirmative observations for the same `store_id`. Report each item's timing. Surface `available` with an explicit retailer pickup estimate, as confirmed in the replay. Keep `all_in_stock` reserved for two explicit `inStock` values. |
| “Can I get two packs delivered if pickup is unavailable?” | Request quantity `2` for the exact variant. Present a market-level delivery method, fee and timing as supplied. A single-SKU quote cannot price a mixed basket. |
| “Is that the price I pay, and how much is it per kilo?” | Label general sale or Family terms. Compute an effective unit price from the detail offer only when the exact pack weight is verified. Keep public online price separate from any branch price. |
| “I need this brand's food.” | Ask for a pack size or variant before promising exact matches when several remain plausible. |

## Task 2 — Replay using the existing MCP tools

**Inputs** Use `search_products({ query, limit: 10 })` to discover candidates, then `get_product({ product_id })` to confirm variant identity and current offer. Use `get_product_availability({ product_id, city })` for one item, `find_common_stores({ product_ids, city })` for two, and `get_delivery_options({ product_id, quantity })` for the delivery fallback.

- [x] Build with `npm run build`. Replay the prompts through the built server over stdio using a JavaScript MCP SDK client and `structuredContent`. Start one process per market. Run live cases sequentially and record tool calls, timestamps, and the final shopper decision. Keep the replay local and use the existing in-memory harness if a permanent deterministic check is needed.
- [x] Compare the results with the matching storefront product, offer, and branch pages in the same session. Record one row per prompt with the expected decision, reported decision, supporting fields, and pass, fail, or live evidence unavailable. Preserve original observation times, including for cached results.
- [x] Check the failure cases below against the existing contracts and tests. If composition fails, reproduce the smallest gap with an offline fixture and identify whether the client workflow or a tool owns the fix. Treat a genuine upstream unknown as a valid outcome when the shopper can see the uncertainty.

| Failure case | Required outcome |
| --- | --- |
| Search returns the right brand and flavor in the wrong size | Leave the requested variant unresolved and ask for clarification. |
| Stock is `inStock` and pickup text says tomorrow or is missing | Report tomorrow or unknown timing. Same-day pickup requires explicit same-day evidence. Stock quantity is unknown. |
| Two products have stock at different stores, or one lookup fails | Show no confirmed common branch. Distinguish a failed lookup from an explicit out-of-stock observation. |
| A Family offer has a published unit price based on the regular amount | Label the Family price. With verified weight, calculate the effective member rate from the Family pack price. For example, €18 for 3 kg yields €6/kg. With missing weight, omit the effective rate. |
| Delivery response has a “from” fee or lacks a date | Keep the “from” qualifier or report timing as unknown. Label the quote as market-level. |

## Task 3 — Publish the smallest working workflow

- [x] If composition passes, add a README recipe with SK and CZ examples for exact restock and two-item pickup. Include the stock timing, delivery quantity, and Family terms limits from the replay. Keep the tool interface unchanged for this path.
- If a failure blocks the shopper's decision and the storefront exposes the required information, write one focused failing regression and patch the responsible layer. Re-run that scenario and the focused test. Record any upstream limitation that remains.
- [x] Run `git diff --check`. For a runtime change, also run `npm run typecheck` and `npm test`. Record the changed files and verification in `docs/investigation.md`.
- [x] Release the recipe once both markets have a verified exact-variant result, a verified common pickup result, and a verified delivery fallback on supported fixtures or live evidence. Record which checks used live data. All failure cases must retain their stated uncertainty. If live data is inconclusive, report that market check as pending.

## What earns the next build

| Observed blocker | Next evidence and implementation gate |
| --- | --- |
| Shoppers supply the packaging barcode or name search repeatedly leaves the pack ambiguous | Try ordinary public search with `8594031442844` in SK and CZ. Confirm exact EAN equality in detail for `294-101115`. Add barcode lookup only for a verified market and route. The traced app scanner returned HTTP 403 anonymously. [EAN investigation](../../investigation.md#exact-barcode-lookup-verification) |
| A shopper needs to browse products stocked at a specific branch | Use the saved REA clue `query.warehouses` to investigate the public storefront's branch filter. Verify branch ID mapping with positive and negative results against per-variant stock across multiple branches before exposing any filter. The saved warehouse sample contained zero counts. [Catalogue filter investigation](../../catalogue-filter-investigation.md) |
| A shopper needs a lower price on their exact pack | Verify general and Family offers via `get_product`. Compare effective prices per kg only with confirmed comparable weights and consistent eligibility. `browse_products` already supports offer filtering for discovery. Describe the best verified result as best among the products checked. Consider a watch after repeated demand for exact-pack monitoring. [Offer evidence](../../investigation.md#public-deal-verification--2026-11-24) |
| A shopper asks when their current pack will run out | Reuse existing feeding-table research. Validate grams per day, publisher attribution, exact product linkage, and two-axis tables before estimating pack duration from published guidance. [Feeding table investigation](../../investigation.md#feeding-table-verification--2026-11-23) |

If the workflow later gets public use, track voluntary feedback on whether it answered the pickup or price decision. Use that evidence to rank the branches above. Until then, public discussions inform the scenarios and the replay measures whether the workflow can answer them.
