# API notes

Verified through bounded anonymous requests on 2026-11-06. No account was accessed. These are undocumented storefront/app endpoints, not a guaranteed third-party API.

## Market evidence

| Market | Storefront | Search mutation / language | Currency | Default price level |
| --- | --- | --- | --- | --- |
| SK | `https://www.superzoo.sk` | `superzoo_sk` / `sk` | EUR | `22` |
| CZ | `https://www.superzoo.cz` | `superzoo_cz` / `cs` | CZK | `1` |
| PL | `https://superzoo.com.pl` | `superzoo_pl` / `pl` | PLN | Unverified |

SK and CZ settings were observed in the app's locale configurations. The Polish storefront exposes the `superzoo_pl` identity. Its search, product and availability endpoints were separately verified live. Parent-company brands such as Dino Zoo are not Super zoo storefronts and are not supported here.

The Polish default price level has not been verified. The implementation conservatively excludes Polish search candidates with any explicit disallowed price levels rather than borrowing the Czech or Slovak level. This can omit otherwise eligible products.

## Endpoints

### Search

`GET https://full-text-search.superzoo.cz/search/api/mutations/{mutation}/languages/{language}/search`

Parameters: `term`, `limit`, `types[0]=productCatalogue.product`, `f_must_not[0]=productSaleForbidden:true`, plus `f_must_not[1]=disallowedPriceLevels:{level}` where the market's default is verified.

A limit of 200 was accepted by the service. Result items can include brands despite the `types` parameter, so filter locally and never describe `totalCount` as a product count. Attributes contain arrays such as `productSaleForbidden: ["false"]` and `disallowedPriceLevels: []`. Initial probes did not verify search pagination or a reliable server-side product-only filter. The dated follow-up below records a bounded `page=2` observation; runtime pagination remains deferred.

### Product and price

`GET {storefront}/web-api/products/{product_id}`

Returns identity, variants, price and availability summary. All three markets accepted anonymous requests. Product `294-101115` returned `13.99` EUR in SK, `359` CZK in CZ and `27.99` PLN with a `familyPrice` variant and `39.99` original price in PL during initial probes. These observations are historical examples, not current price promises.

A conditional offer can be returned anonymously. Preserve `price.variant`; do not infer membership eligibility. Currency comes from the verified storefront configuration, since the price object itself omits it.

### Store availability

`POST {storefront}/web-api/products/{product_id}/availability`, JSON body `{}`.

This POST reads stock; it does not reserve or purchase. All three markets returned store IDs, names, addresses, aliases, opening hours, stock status and pickup text. Exact quantities and branch prices were absent. `inStock` can accompany a pickup time tomorrow.

## Discovery and provenance

The initial supplied Android package was React Native / Expo 54 with a Hermes v96 JavaScript bundle. REA inspected and extracted it; Hermes disassembly identified service routes and locale settings. Live HTTP probes independently verified the endpoints. No app code is executed or redistributed by this server.

The supplied XAPK SHA-256 was `e4e9e731a093342720db70357aadd321ab4eade341f2395fe87fb0faff550d0d`; its base APK was `cz.cleevio.superzoo.apk`. Raw app artifacts, decompiled extracts and full response captures remain excluded from version control. Tests contain only small public-data fixtures needed to exercise the response contract.

Account login, refresh, personal discounts, exact stock quantities and branch-specific prices remain unverified and outside this implementation.

## Discovery follow-up — 2026-11-07

Task 4 reviewed the existing reduced fixtures, local anonymous response captures, and saved app API excerpts before making **12 anonymous requests, sequentially**, between 04:02:23 and 04:03:57 UTC (05:02:23–05:03:57 Europe/Bratislava). All returned HTTP 200. Probes used no credentials, cookies, account endpoints, retries, or redirect following. This section records observations at those times, not enduring catalog or availability guarantees. Full response bodies and downloaded scripts are not committed.

### Probe inputs and endpoints

The evidence IDs below identify individual requests. Times are UTC on 2026-11-07; inputs were fixed before each request.

| ID | Market | Official endpoint and input | Time |
| --- | --- | --- | --- |
| E1 | SK | `GET https://www.superzoo.sk/web-api/products/294-101115` | 04:02:23.702 |
| E2 | CZ | `GET https://www.superzoo.cz/web-api/products/294-101115` | 04:02:24.945 |
| E3 | PL | `GET https://superzoo.com.pl/web-api/products/294-101115` | 04:02:26.449 |
| E4 | PL | `GET https://superzoo.com.pl/` | 04:02:27.787 |
| E5 | PL | `GET https://superzoo.com.pl/dist-superzoo_pl/js/main.5804e444.bundle.js`, linked by E4 | 04:02:53.433 |
| E6 | SK | `GET https://full-text-search.superzoo.cz/search/api/mutations/superzoo_sk/languages/sk/search`, baseline query below | 04:02:53.641 |
| E7 | SK | Same endpoint and baseline as E6, plus `offset=5` | 04:02:54.104 |
| E8 | PL | `GET https://full-text-search.superzoo.cz/search/api/mutations/superzoo_pl/languages/pl/search`, `term=brit care`, `limit=200`, `types[0]=productCatalogue.product`, `f_must_not[0]=productSaleForbidden:true`; no price-level exclusion | 04:03:24.552 |
| E9 | SK | `GET https://www.superzoo.sk/brit-care-salmon-oil-250ml/` | 04:03:24.964 |
| E10 | SK | Same endpoint and baseline as E6, plus speculative `brand=__superzoo_probe_no_such_brand__`, `min_price=999999`, `max_price=999999` | 04:03:56.668 |
| E11 | SK | Same endpoint and baseline as E6, plus `page=2` | 04:03:56.945 |
| E12 | PL | `GET https://superzoo.com.pl/web-api/products/294-172197`, selected from E8 | 04:03:57.336 |

E6 baseline query: `term=brit care`, `limit=5`, `types[0]=productCatalogue.product`, `f_must_not[0]=productSaleForbidden:true`, `f_must_not[1]=disallowedPriceLevels:22`. Query values were URL-encoded on the wire. E10's parameter names were exploratory guesses, not a documented upstream interface.

### Evidence and implementation implications

“High” means directly observed in these samples; it does not establish a complete enum, universal field presence, or cross-market behavior beyond the named samples. “Unverified” records a bounded search that did not establish the capability.

| Capability | Market / evidence / time | Observed response | Confidence | Implementation implication |
| --- | --- | --- | --- | --- |
| Exact brand source | SK E1 04:02:23.702; CZ E2 04:02:24.945; PL E3 04:02:26.449 and E12 04:03:57.336 | `product.brand.name` was `Brit Care`; the brand object also carried a stable ID and alias. | High for field and sampled values | Apply the planned exact, case/accent-insensitive brand filter to enriched `brand`; do not infer brand from titles, descriptions, or mixed search brand hits. Missing brand remains unknown. |
| Package volume | SK/CZ/PL E1–E3 | Active variant `294-101115` had display name `250 ml`; other variant IDs had `500 ml` and `1 l`. `price.originalUnitPrice` and `price.sellUnitPrice` were null. No normalized numeric package-size field was identified in these samples. | High for display values; normalized size unverified | Preserve variant IDs. Display names alone do not establish a general package parser or reliable unit-price calculation. Unit-price work remains deferred. |
| Package mass and supplied unit price | PL E12 04:03:57.336 | Active variant `294-172197` was `3 kg`; a localized parameter also read `Gramatura: 3 kg`. Both unit-price objects were `{unitPrice: "2.83", unitSize: "100", unit: "g"}` alongside `sellPrice: "84.99"`. | High for this product; coverage/rounding policy unverified | Structured upstream unit-price fields do exist for some products. They describe price per 100 g, not total package mass. Do not derive exact package mass by reversing rounded unit prices. Runtime unit prices remain a separate follow-up. |
| Explicit online delivery availability | SK/CZ/PL E1–E3; PL E12 | `availability.deliveryAvailability.availability` was `available` for E1–E3, with delivery text; E12 returned `notAvailable` with text `niedostępne`. E9 independently advertised `https://schema.org/InStock` for E1's product. | High for observed code meanings; full enum unverified | Use the narrow mapping below for `online_only`; retain unknown values and separate store stock from delivery status. |
| Purchase flag versus delivery | PL E12 | `product.canBuy` was true while delivery was `notAvailable`; store summary was `available`, with three available stores. | High; direct counterexample | `can_buy` alone cannot implement an online-delivery filter. Store count and store summary cannot substitute for delivery status. |
| Conditional public offer | PL E3 | Anonymous offer was `sellPrice: "27.99"`, `originalPrice: "39.99"`, `variant: "familyPrice"`. | High for observation; eligibility unverified | Filter the returned decimal offer as planned while preserving its conditional label. Do not treat it as proof of membership eligibility or default price level. |
| Search type filtering and count | SK E6; PL E8 | E6 returned two brand hits and three product hits, `totalCount: 233`. E8 returned 187 items: 184 products, two brands, one article. | High for these requests | Keep local type checks and describe total count as mixed upstream results. Neither request proves full-catalog coverage. |
| Server-side brand/price filters | SK E6 versus E10 | E10's impossible brand and price selectors returned the same response body as E6, including the `13.99` offer's product ID. | High for ineffectiveness of these exact parameters; alternative syntax unverified | Do not send guessed brand/price filters. Apply filters locally to enriched candidates within the existing 200-candidate ceiling. |
| Offset pagination | SK E6 versus E7 | `offset=5` returned the same five IDs in the same order and the same total count. | High for this negative probe; other offset syntax unverified | Do not assume `offset` works. |
| Page pagination | SK E11 versus E6 | `page=2` returned five different product IDs with the same total count, beginning `294-172197`, `294-172198`, `294-172210`, `294-172194`, `293-569212`. | High for observed page change; indexing, continuity, stability, and other markets unverified | A page selector works for this sample. Runtime pagination and broader catalog retrieval remain deferred by scope; do not expand Task 5 beyond 200 candidates. |
| Polish restrictions/default level | PL E3–E5 and E8 | All 184 product hits in E8 had empty `disallowedPriceLevels`. E3's conditional offer contained no default-level ID. No `defaultPriceLevel` or `priceLevel` occurrence was found in E4 HTML or E5's main script. | Default level unverified | Preserve exclusion of Polish candidates with explicit disallowed levels. Empty arrays and a family offer cannot identify the anonymous default level. Do not borrow SK/CZ IDs. |

### Online availability mapping for Task 5

The verified source is **`availability.deliveryAvailability.availability`**, not `storeAvailability.availability`, a branch's `availability.status`, or `product.canBuy`.

| Raw delivery value | Meaning supported by these probes | Treatment when `online_only: true` |
| --- | --- | --- |
| `available` | Explicit delivery availability, observed in SK/CZ/PL E1–E3 | Include as a delivery-available candidate, subject to the other requested filters. Preserve pickup/delivery text and conditional price labels. |
| `notAvailable` | Explicit unavailable delivery, observed in PL E12 alongside `niedostępne` | Omit. |
| Missing object, missing/null code, or any other code | Unknown; no complete delivery-status enum was established | Omit from the positive filter; do not rewrite the raw status as confirmed unavailable. |

This supports a conservative `online_only` allowlist for the observed `available` code. It does not promise delivery to a particular address, exact timing, a purchasable quantity, or account eligibility. A broader mapping remains unverified. In particular, branch `inStock` from existing fixtures must not be added to the delivery allowlist without separate evidence.

### Limits and handoff

Only `docs/investigation.md` changes for Task 4. Task 5 can use enriched exact brand and decimal offer fields and the delivery allowlist above. Search pagination, unit prices, and Polish price-level runtime changes remain deferred even where new fields or behavior were observed.

The negative configuration search covered the saved app excerpts and only E4's HTML and its linked E5 main script, not every lazy-loaded resource or backend configuration. REA's JavaScript analyzer rejected the downloaded standalone bundle with `artifact_operation_failed` / `reason: format`; bounded local text searches supplied the negative observations instead. No static-analysis result or full application trace is claimed. The 12-request budget ended before further probes; this is incomplete capability coverage, not evidence that other fields, codes, filters, or configuration do not exist.

## Enhancement release smoke, 2026-11-07

Initial bounded smoke invocations for SK, CZ and PL passed search/detail but failed the canary's stock-code allowlist. One diagnostic anonymous SK request to `POST https://www.superzoo.sk/web-api/products/294-101115/availability` returned a schema-valid result containing raw branch statuses `available` and `notAvailable`. The canary now accepts the observed `available` code without treating it as `inStock`. Runtime preserves the raw value; common-store `all_in_stock` still requires every requested product's explicit `inStock`, so `available` remains insufficient for that claim. This observation does not establish a complete stock enum or pickup timing.

After the canary correction, one smoke invocation per market passed search, explicit detail, and stock validation on 2026-11-07. Each invocation made three anonymous upstream requests (the explicit detail step reused the detail fetched during search). These are point-in-time checks, not guarantees of future availability. No branch-status interpretation or Polish restriction policy changed.

## Branch-status follow-up, 2026-11-07

Three sequential anonymous requests used `POST {storefront}/web-api/products/294-101115/availability` with JSON `{}`, no account, and no retry. All returned HTTP 200:

| Market | Official storefront | UTC retrieval | Observed status and pickup text |
| --- | --- | --- | --- |
| SK | `https://www.superzoo.sk` | `2026-11-07T04:32:48.906Z` | `available`: `do 5 hodín`, `do 6 hodín`; `notAvailable`: `nedostupné` |
| CZ | `https://www.superzoo.cz` | `2026-11-07T04:32:49.775Z` | `available`: `do 4 hodin`, `do 5 hodin`, `do 6 hodin`; `notAvailable`: `nedostupné`; `inStock`: `v úterý` |
| PL | `https://superzoo.com.pl` | `2026-11-07T04:32:50.741Z` | `available`: `w ciągu 5 godzin` |

Confidence is high for these observed code/text pairs, but they do not establish a complete enum, physical on-hand inventory, or quantities. `available` accompanies a short pickup window; `inStock` can still accompany a later pickup day. Neither raw code alone promises immediate pickup. Preserve the upstream status and pickup text separately. The existing conservative `all_in_stock` predicate remains literal `inStock` for every requested product, protected by a regression for `available`. Thus `all_in_stock: false` is not proof that a store cannot supply the products: inspect the per-product observations. No broader code mapping was inferred from timing text.

Only these three requests were made for this follow-up. Raw captures and the request ledger remain local under `/private/tmp/superzoo-followup-evidence/`; no full store payloads are redistributed in this repository.
