# Super zoo catalogue filtering

Snapshot from 2026-11-24. The [filter inventory](catalogue-filter-inventory.jsonl) lists every product-category entry returned by public animal-category navigation in Slovakia, Czechia, and Poland. It includes the raw facets and exact values returned for every Slovak and Czech scope in that navigation. These findings describe the upstream catalogue. The MCP loads category navigation and filter values live for Slovakia and Czechia.

## Coverage

| Animal department | SK entries | CZ entries | PL entries |
| --- | ---: | ---: | ---: |
| Dogs | 23 | 24 | 22 |
| Cats | 19 | 19 | 17 |
| Small mammals | 17 | 17 | 15 |
| Birds | 11 | 12 | 9 |
| Aquariums | 14 | 14 | 13 |
| Terrariums | 14 | 14 | 13 |
| **Total** | **98** | **100** | **89** |

- All 198 Slovak and Czech entries resolved by exact alias. Shared routes reduced them to 93 SK scopes and 95 CZ scopes. All 188 queries returned the requested facet response. One scope in each market had zero products.
- SK advertised 69 distinct category parameter IDs across 275 scope-and-parameter pairs. CZ advertised 71 across 275 pairs. All 69 SK IDs also appeared in CZ. Localized aliases and allowed values vary by market and scope.
- The sweep requested brands, category parameters, campaigns, categories, reviews, and prices, the app’s six default facet groups. The optional tag and warehouse groups were tested on one scope per market. Category facet responses referenced 553 SK and 550 CZ IDs outside the app navigation snapshot. The inventory includes those IDs where they appear as selectable values. Their own scopes and facets remain unexplored.
- PL navigation, one exact category route, and the sampled storefront category page returned HTTP 200. The page exposed brand, category, product parameter, review, price, and sorting controls. The storefront filter descriptor returned HTTP 500 for the sampled alias in bare, path, and absolute URL forms. The separate filter service required a string price level. Two Polish product records listed several levels and did not identify the default. The PL rows therefore record navigation and the one resolved scope.

Each inventory line is a JSON object for one navigation entry. `navigation_id` and `scope_id` represent different upstream IDs. `parameters` maps each localized request alias to its stable parameter ID and a map of exact returned values to upstream counts. `brands`, `campaigns`, and `categories` map upstream IDs to counts. `reviews` maps star values to counts. `price_range` holds the upstream catalogue bounds in the market currency. Catalogue totals and facet counts precede the MCP's product eligibility checks. Values and counts can change with the selection, market, and catalogue.

## Request fields and evidence

REA confirmed the local Super zoo Android 2.0.13 XAPK against manifest `agm_ff9638962bc438ade370408a673e12af5c61703aa00c314ca3d94dae972a5494` and inventory evidence `ev_9ebeb14d521f6f01d7baa553f9fac3364af25383a8f80303cf3d3645b1c851cf`. The saved Hermes v96 bundle matched the extracted base APK asset at SHA-256 `d18e5d8380a0bdecf4711c54aeefc32bb2938b02e1ec55404dd7ec1916b8ef56`. The app was inspected statically using the saved bundle and focused Hermes disassembly. Live probes were anonymous HTTPS requests with deadlines, pacing, redirects disabled, and no retries.

The app reads animal navigation, resolves each route alias to `settings.resourceId`, and passes that ID as `scope.category`. The discovery sweep sent an empty `query`, all six default facet groups, and page 1 with a limit of one. The storefront view-model endpoint can turn those raw facet values into localized labels, input types, and sort metadata. The sampled decoration view model returned numeric length and height and choice controls for color and decoration type in both markets. The SK view model also returned the Czech currency label `Kč`. Use the market currency and raw price decimals for amounts.

| Capability | APK fields and references | Live SK and CZ evidence |
| --- | --- | --- |
| Category choices | `query.parameters: [{ alias, values: [...] }]`, Hermes `#57382–#57385` | Brown or green returned 56 SK and 57 CZ results. The first ten eligible results in each matched one of the two values. Earlier dog food probes verified two distinct parameters together across pages. |
| Numeric facets | The same parameter array carries range objects in `values`, Hermes `#57368`, `#57385` | Aquarium length up to 15 cm using `values: [{ from: 0.01, to: 15.01 }]` returned two candidates in each market. An exact string `"14"` returned one. Its joined parameter stored `value: "14"` with `alias: null`. Both public detail responses confirmed 14 cm. |
| Price range | `query.price: [{ from, to }]`, Hermes `#57368`, `#57380–#57381` | The app-shaped range returned 145 results at EUR 5.14–19.99 and 123 at CZK 104–499. The simpler array and `{ min, max }` forms returned HTTP 500 in the same test. These are catalogue price bounds. Advertised offers need a detail check. |
| Brand, category, campaign, review | `query.brands`, `query.categories`, `query.campaigns`, `query.reviews`, Hermes `#57379` | Selected brand, category and campaign IDs and a 5-star value each reduced the decoration result total to the matching advertised facet count. |
| Stock and promotion flags | `filters.onlyInStock`, `filters.onlyOnSale`, `filters.promotedOnly`, Hermes `#57379`, `#57386`, `#57586` | Turning on stock reduced decoration counts from 235 to 228 in SK and from 196 to 195 in CZ. Per-store inventory remains a separate check. Turning on promotion or turning off the default sale gate kept the same totals. The existing deals implementation checks public offer details. |
| Tags and warehouses | `query.tags`, `query.warehouses`, Hermes `#57379`. The enum also includes both facet families in `#57057`. | Explicit facet requests returned three SK tags and two CZ tags. Applying one returned tag matched its facet count in each market (72 SK, 63 CZ). Both responses listed 293 warehouse IDs, all with zero counts for the sampled scope. Warehouse-to-store identity and positive stock matching remain unverified. |
| Sorting | `sort.sortBy` and `sort.order`, Hermes `#57057`, `#57112`, `#57370` | App choices include cheapest, most expensive, unit price where enabled, popularity, and reviews. Review and popularity sort requests returned HTTP 200. This check did not establish full ordering semantics. Earlier pack and unit sort probes changed catalogue ordering and surfaced differences from current advertised prices. |
| Context and paging | `scope.category`, `scope.brand`, product-ID search scope, deal and tag views, and `paging: { page, limit }`, Hermes `#57255`, `#57334`, `#57452`, `#57483`, `#57586`, `#59759`, `#59798` | The app passes keyword candidates in `scope.productIds` and defaults to `idsList` order. Both anonymous probes preserved relative search order across two pages. An aquarium decoration category and price range also worked together within the supplied search IDs. |

The keyword test requested 40 upstream search hits per market. It obtained 37 distinct product IDs in SK and 33 in CZ. Adding the category filter left 31 and 32. Adding the price range left 26 in each. Those counts cover only the submitted IDs. The APK requests up to 1,000 search hits (`#59762`); this live check used a smaller limit.

The APK's separate animal-context route accepts `animalId` and `categoryId` (Hermes `#15708`, `#57406`). This investigation covers public catalogue filters. The animal-context behavior remains unverified.

## MCP catalogue tools

The category discovery and browsing tools use the same market and scope. Live checks confirmed that a scope containing both `category` and `productIds` intersects the two constraints. The filter service requires JSON floats for range bounds, including values written as whole numbers, such as `20.0`. Discovery keeps the exact upstream value when a display label rounds it.

Aquarium decorations are one example. SK returns `farba`, `typ-dekoracie`, `dlzka`, and `vyska`. CZ returns `barva`, `typ-dekorace`, `delka`, and `vyska`. The sampled product detail also included depth and material, which were absent from the category's filter set. Use product detail to confirm fit or other attributes the facet data cannot establish. The same discovery flow applies to cage material, tank volume, terrarium dimensions, dietary needs, and pet life stage.

Live values should drive discovery when the MCP adds broader support. Preserve product eligibility checks, distinguish online from store availability, and verify any contracted price or sort behavior with joined product details.
