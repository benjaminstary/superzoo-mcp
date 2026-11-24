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

## Anonymous store locator — 2026-11-23

### APK trace

Hermes v96 from the REA-extracted Super zoo 2.0.13 package ties the store repository to the locale's storefront `/web-api` base (`#14779`, `#37874`, `#15796`). The trace supports the official SK and CZ hosts. It did not establish a locator route for PL, whose product and stock endpoints were verified separately.

| App call | Request relative to `/web-api` | Evidence |
| --- | --- | --- |
| Store detail | `GET /stores/{pickupPlaceId}` | `#15722` passes the branch selector to the route builder declared in `#14895`. Static trace only. |
| Store filter | `POST /stores?limit=…&offset=…` | `#15726` forwards `filters`, `filterRegion`, `coordinates`, and `storeIds` in the JSON body. `#15843` supplies empty filters, null region and coordinates, and query defaults of `10` and `0`. `#56885` passes the selected region value and caller coordinates. `#45879` reads `results` and `totalCount`. Free-text city selection and live pagination remain unverified. |
| Nearest store | `POST /stores/nearest-store` | `#15730` sends the coordinate object as the whole body. `#44407` builds it from device location as named `latitude` and `longitude` values in decimal degrees. `#55895` reads `nearestStore` from the response. |

The nearest-store request coordinates describe the caller's search point. The response's top-level store latitude and longitude describe the returned branch. The app also uses branch coordinates for its map and distance display (`#56459`).

### Anonymous probes

One read-only nearest-store POST per traced market at 14:25:48 UTC (15:25:48 Europe/Bratislava). Both used public city-center coordinates and JSON with numeric `latitude` and `longitude`, without cookies, credentials, retries, or redirect following.

| Market and selector | Status | Branch and shape | Stock ID comparison |
| --- | --- | --- | --- |
| SK, Bratislava center | HTTP 200 JSON | `SKPIC-400`, Bratislava Aupark Shopping Center, Einsteinova 18, Bratislava. Numeric branch coordinates, formatted hours and a seven-day hours list. | Related store `SKPIC-520` matches the ID, name and address of Bratislava Central in the saved stock fixture. The primary branch ID was absent from that fixture. |
| CZ, Prague center | HTTP 200 JSON | `CZPIC-330`, Praha Podbaba, Pod Paťankou 2750/1c, Praha 6. Numeric branch coordinates. Both hours fields showed `0:00–0:00`; its meaning is unverified. | The saved stock evidence had no matching Czech branch record for comparison. |
| PL | No probe | Official locator route, response shape and coverage remain unverified. | ID equivalence remains unverified. |

Reduced SK response (selected fields):

```json
{
  "nearestStore": {
    "id": "SKPIC-400",
    "name": "Bratislava Aupark Shopping Center",
    "address": "Einsteinova 18, Bratislava",
    "openingHoursList": [
      {
        "day": "monday",
        "date": "2026-11-23T00:00:00+01:00",
        "timeRanges": [{ "from": "10:00", "to": "21:00" }]
      }
    ],
    "closestStores": [{ "id": "SKPIC-520", "distance": "3.2 Km" }]
  }
}
```

Each market returned one `nearestStore` with three `closestStores` entries and no pagination fields. The related list included the returned store at `0.0 Km` even when its reported coordinates differed from the request. The distance labels are in kilometers, and the observed zero indicates a branch-relative origin. The distance calculation and broader coverage remain unverified. These samples support a coordinate-only, single-branch lookup in SK and CZ. Independent branch-coordinate validation, caller-distance ranking, city filtering, and pagination remain open. The one exact Slovak stock ID match confirms equivalence for Bratislava Central. A broader stock join for either market needs more evidence. [Stock fixture](../test/fixtures/store-availability.json)

## Anonymous category browsing — 2026-11-23

### APK trace

| Hermes references | Request and role |
| --- | --- |
| `#15658`, `#54438` | Storefront `GET /web-api/navigation/animal-category` returns `items`. The app passes an undefined user ID when the account is absent. |
| `#15704`, `#38181` | Storefront `POST /web-api/products/parameter-filter/query` accepts a JSON object with `url`. The app passes an undefined user ID when the account is absent. The Czech response shows that this route resolves a URL into a filter request. |
| `#15684`, `#57334` | Storefront `POST /web-api/products/parameter-filter` builds the facet view model. The app passes facets from a filter response and, for a category scope, `scope: { type: "category", categoryId: … }`. The call has no user ID argument. |
| `#15708`, `#57406` | Storefront `POST /web-api/products/parameter-filter/animal` takes `animalId` and `categoryId`. The app passes an undefined user ID when the account is absent. This path was traced only. |
| `#14779`, `#18191`, `#18346`, `#18348`, `#57334`, `#57359` | `POST /filter-products/{apiWebId}` on the separate parameter-filter service submits the filter body and has no user ID argument. The production package domain resolves to `parameter-filter.superzoo.cz`. The locale IDs are `superzoo_cz` and `superzoo_sk`. The app starts with `paging.page: 1`, sends `paging.limit`, and consumes `products`, `totalCount`, and `facets`. |

The app maps parameter aliases and their allowed values into `query.parameters` (`#57067–#57070`, `#57379`, `#57382`). Concrete facet aliases and values, including life stage, still need a successful live response. The app's separate purchase eligibility helper checks `productSaleForbidden` and whether `disallowedPriceLevels` includes the active level (`#15023`). That check does not establish which products the parameter-filter service excludes.

### Anonymous probes

Five sequential HTTPS requests omitted user IDs, cookies, and credentials. Each had a 12-second deadline, zero retries, and no redirect following. Times are local to Europe/Bratislava.

| Time | Market and request | Result |
| --- | --- | --- |
| 15:36:34 | SK GET `https://www.superzoo.sk/web-api/navigation/animal-category` | HTTP 200 JSON. Six groups. The `dogs` group's `Granuly pre psov` entry has ID `42eeee01-5544-4e68-8130-bef9755298ae` and alias `psy/krmivo-a-pochutky/granuly-pre-psy`. |
| 15:36:34 | CZ GET `https://www.superzoo.cz/web-api/navigation/animal-category` | HTTP 200 JSON. Six groups. The `dogs` group's `Granule pro psy` entry has the same sampled ID and alias `psi/krmivo-granule/granule`. |
| 15:37:27 | SK POST `https://www.superzoo.sk/web-api/products/parameter-filter/query` with the discovered alias wrapped in slashes as `url` | HTTP 500 JSON. Stopped probing this route. No Slovak filter request was established. |
| 15:37:27 | CZ POST `https://www.superzoo.cz/web-api/products/parameter-filter/query` with the discovered alias wrapped in slashes as `url` | HTTP 200 JSON. Returned `scope.category: "c1955f56-7438-4c93-8875-9dc8f634acd9"`, which differs from the navigation ID and was absent from the captured navigation children. Returned `priceLevel: "1"`, `filters.onlyOnSale: true`, `paging: { limit: 15, page: 1 }`, and requested facet groups `parameters`, `prices`, `campaigns`, and `reviews`. |
| 15:38:52 | CZ POST `https://parameter-filter.superzoo.cz/filter-products/superzoo_cz` with the Czech descriptor as returned | HTTP 500 JSON. Stopped probing this route before a facet or second-page request. |
| — | PL | No probe. The APK trace did not establish the Polish route and market configuration for this flow. |

Anonymous navigation is verified for SK and CZ. The relationship between navigation IDs and filter scope IDs remains unresolved. The CZ descriptor's sale-only setting and default price level are request inputs. Both product-level exclusion checks and pagination remain unverified. No market met the evidence gate for Task 5. Raw captures remain local.

### Category filter recheck — 2026-11-23

The repository evidence and public searches for the two filter routes and their OpenAPI or Swagger documentation yielded no new route contract, verified app request, or recovery evidence. Super zoo's Czech help centre describes pet-profile filtering in selected categories. That guidance covers the app experience and provides no anonymous request contract. [Super zoo filtering help](https://www.superzoo.cz/jak-funguje-filtrovani-produktu-pro-meho-mazlicka/)

The previous SK descriptor and CZ product filter calls each returned HTTP 500. Neither call was repeated. Anonymous facet values, product identity and exclusions, and result coverage still need verification in one market before category browsing can proceed.

### APK request construction — 2026-11-23

REA identified the checked local Super zoo 2.0.13 XAPK and its split packages in artifact manifest `agm_ff9638962bc438ade370408a673e12af5c61703aa00c314ca3d94dae972a5494`. The base APK's `assets/index.android.bundle` matched the saved Hermes bytecode by SHA-256. A focused Hermes disassembly traced request construction without running the app.

- `#57321`, `#57331`, `#57378`, `#57379`, and `#57386` show the app building a new filter body from defaults, a supplied scope, and selected values. The factory starts with the current shop price level, merges query fields, sets sale filters and facet groups, and applies sorting. `#57334` then sets paging before `#57359` posts the body. The earlier CZ probe forwarded the storefront descriptor verbatim, so it did not verify this request path.
- `#57382–#57385` show selected parameters serialized as `query.parameters` entries with `alias` and `values`. `#57334–#57335` read `products[].id`, `totalCount`, and `facets` from the filter service. These bytecode references establish the fields the app expects. Concrete category facet values and returned product eligibility still require live verification.

The request factory gives a concrete lead for the next live check. A successful signed-out category filter request and response would establish the exact body and whether the service accepts it today. The APK does not establish the cause of the previous HTTP 500s.

### Verified Czech dog-food category filter — 2026-11-23

The APK's alias router resolves a navigation alias through the read-model `route` collection and passes `route.settings.resourceId` to the category screen (`#36724`, `#36729`, `#36734–#36737`, `#31326`). The category screen uses that resource ID as `scope.category` (`#57452`, `#57456`). ADB ran but listed no devices, and no emulator was configured. The live results below are anonymous requests reconstructed from the APK trace.

Four HTTPS requests ran sequentially with a 12-second deadline each, no retries or redirects, and no credentials or cookies.

| Request | Result |
| --- | --- |
| `POST https://read-model.superzoo.cz/collections/route/webs/superzoo_cz/languages/cs/documents/filter` with `{"ids":["psi/krmivo-granule/granule"]}` | HTTP 200. The exact alias resolved to a category with resource ID `c1955f56-7438-4c93-8875-9dc8f634acd9`. Its navigation entry ID is `42eeee01-5544-4e68-8130-bef9755298ae`. |
| `POST https://parameter-filter.superzoo.cz/filter-products/superzoo_cz` using the reconstructed first-page body below | HTTP 200. Returned 10 distinct product IDs, `totalCount: 784`, and the `stari-psa` dog age facet. The advertised values were `dospely` (531), `senior` (222), and `stene` (211). A product can have multiple values. |
| Same filter request with `query.parameters: [{ "alias": "stari-psa", "values": ["senior"] }]` | HTTP 200. Returned 10 distinct product IDs and `totalCount: 222`, matching the unfiltered facet count for `senior`. All 10 joined product records had the `senior` value. |
| `POST https://read-model.superzoo.cz/collections/product/webs/superzoo_cz/languages/cs/documents/filter` with `{"ids":[...]}` for the 19 distinct IDs from both pages | HTTP 200. All 19 IDs matched `items[].product.productId`. Every product was published, explicitly had `productSaleForbidden: false` and `disallowedPriceLevels: []`, and had a price record for that exact product ID, web ID `superzoo_cz`, and level `"1"`. |

The first-page body includes all six facet groups, an empty query, and no explicit sort, following the category factory defaults (`#57321`, `#57331`, `#57334`, `#57370`, `#57376`, `#57378–#57379`). The earlier Czech descriptor included a different facet list, empty query arrays, and an explicit sort. The successful request verifies the new body as a whole.

```json
{
  "priceLevel": "1",
  "scope": { "category": "c1955f56-7438-4c93-8875-9dc8f634acd9" },
  "filters": { "onlyOnSale": true, "onlyInStock": false, "promotedOnly": false },
  "facets": ["brands", "parameters", "campaigns", "categories", "reviews", "prices"],
  "query": {},
  "paging": { "page": 1, "limit": 10 }
}
```

Reduced fixture for the unfiltered response and one matching filtered product record:

```json
{
  "unfiltered": {
    "products": [{ "id": "294-170827" }],
    "totalCount": 784,
    "facets": {
      "parameters": [{
        "id": "d443960a-8817-4dfb-b453-5ea7d928ab28",
        "alias": "stari-psa",
        "values": [
          { "value": "dospely", "increment": false, "count": 531 },
          { "value": "senior", "increment": false, "count": 222 },
          { "value": "stene", "increment": false, "count": 211 }
        ]
      }]
    }
  },
  "filtered": { "products": [{ "id": "294-170845" }], "totalCount": 222 },
  "productReadModel": {
    "items": [{
      "product": {
        "productId": "294-170845",
        "name": "Brit Premium by Nature Sensitive Lamb 15kg",
        "published": true,
        "productSaleForbidden": false,
        "disallowedPriceLevels": []
      },
      "parameters": [{
        "parameter": { "alias": "stari-psa" },
        "values": [{ "alias": "dospely" }, { "alias": "senior" }]
      }],
      "prices": [{ "productId": "294-170845", "webId": "superzoo_cz", "priceLevelId": "1" }]
    }]
  }
}
```

The Czech category meets the evidence gate for first-page browsing with the dog age facet. Use the product read model to enforce eligibility before returning each result. The app's helper checks the forbidden flag, the level blocklist, and price presence (`#15023–#15024`). The sample contained no restricted products, so upstream exclusion behavior remains unknown and needs explicit negative cases in the implementation tests. Report the upstream total separately from the number of eligible products returned. Pagination, additional categories, SK, and PL remain unverified. Raw captures remain local.

### Slovak dry dog food category filter — 2026-11-23

Four sequential anonymous requests used a 12-second deadline each, with redirects and retries disabled. The Slovak route lookup used `superzoo_sk`, language `sk`, and alias `psy/krmivo-a-pochutky/granuly-pre-psy`. It returned HTTP 200 and resolved the navigation entry `42eeee01-5544-4e68-8130-bef9755298ae` to scope `c1955f56-7438-4c93-8875-9dc8f634acd9`.

The APK-shaped request above returned HTTP 200 at `https://parameter-filter.superzoo.cz/filter-products/superzoo_sk` with `priceLevel: "22"` and the resolved scope. The unfiltered first page contained 10 of 924 matches. It advertised dog-age facet `vek-psa` with `dospely` (545), `senior` (238), and `stena` (222). Setting `query.parameters` to `[{ "alias": "vek-psa", "values": ["senior"] }]` returned HTTP 200 with 10 of 238 matches.

The Slovak product read model batch returned HTTP 200 and joined all 20 distinct IDs from the two pages. All were published, explicitly allowed for sale, and had a price for the same product, Slovak web ID, and level `"22"`. None blocked level `"22"`. All 10 filtered products carried `vek-psa=senior`. This verifies the Slovak category and first-page filter contract. The MCP exposes this category and facet in Slovakia. Raw captures remain local.

### Live dog life-stage filter verification — 2026-11-24

A plain JavaScript MCP client discovered the category and called `browse_products` for each stage in SK and CZ. The requests used the existing anonymous category filter and product read model. Each upstream request had a 12-second deadline with no redirects or retries during the check. Every call returned ten eligible first-page products. The joined records for all returned products contained the requested facet value. Each MCP result echoed the applied facet, and its JSON text matched `structuredContent`.

| Market | Puppy | Adult | Senior |
| --- | --- | --- | --- |
| SK, `vek-psa` | `stena` (222) | `dospely` (545) | `senior` (238) |
| CZ, `stari-psa` | `stene` (211) | `dospely` (531) | `senior` (222) |

Counts are upstream totals before the MCP eligibility checks. This check supplied tool arguments directly.

### Natural-language dog life-stage selection

Three independent Codex agents each received a shopper prompt and access to the selected market through MCP discovery and tool calls. The MCP server ran with simulated catalog responses. Each agent discovered the category, then successfully called `browse_products` with the correct market-specific facet on its first browse attempt. All three produced a shortlist without asking the shopper for a category ID or filter value.

| Market | Prompt | Applied facet |
| --- | --- | --- |
| SK | “Máme doma šteniatko. Vieš mi nájsť granuly preň?” | `vek-psa=stena` |
| CZ | “Hledám granule pro dospělého psa.” | `stari-psa=dospely` |
| CZ | “What dry dog food do you have for a senior dog?” | `stari-psa=senior` |

The three prompts checked tool selection. Live matching for all six market and stage combinations was verified separately above.

### Live shopping flow — 2026-11-24

A plain JavaScript MCP SDK client connected over stdio to the built server in SK at 10:54 Bratislava time. It discovered the dry dog food category and puppy facet via `list_product_categories`, then used `browse_products`, `compare_products`, and `get_delivery_options` in sequence. The filtered first page returned 10 eligible products from 222 upstream matches.

The client compared the first three variants. All three returned standard EUR offers with a published price per 100 g. The client converted those rounded unit prices to approximate EUR/kg.

| Product ID | Pack price | Published price per 100 g | Approximate price per kg |
| --- | ---: | ---: | ---: |
| `214-13177` | €85.79 | €0.43 | €4.30 |
| `214-13182` | €92.90 | €0.46 | €4.60 |
| `214-13180` | €99.00 | €0.50 | €5.00 |

The quote for two units of the lowest-priced sample, `214-13177`, returned DPD delivery at €3.99 including VAT and six store pickup places marked available. The DPD quote reported `2026-11-27T10:00:00+01:00`. The quote was market-level. The sample covered three first-page products and one life-stage and market combination.

### Broader category browsing — 2026-11-23

Saved SK and CZ navigation responses list wet dog food, dry cat food, and cat litter. Saved dry dog food filter responses advertise `vek-psa=senior` and `alergie-psa=bez-obilnin-grain-free` in SK and `stari-psa=senior` and `alergie=bez-obilovin-grain-free-1` in CZ. These values are candidates for a combined filter on dry dog food.

An anonymous POST to `https://read-model.superzoo.cz/collections/route/webs/superzoo_sk/languages/sk/documents/filter` requested the three additional SK category aliases in one `ids` batch. It returned HTTP 403 with a 12-second timeout configured and redirects disabled. The run stopped at that response. Additional scope resolution, combined-filter matches, page order and overlap, final-page behavior, and product eligibility on those pages remain unverified.

A follow-up used the app's single-alias lookup for `macky/podstielky` (cat litter). It returned HTTP 200. The exact route had category template `productCatalogue:category:CATEGORY` and scope `19291e00-26e0-464b-bd6a-b804296ffb14`, distinct from navigation ID `dfc861d8-9069-47db-b29b-5d6afee06f1f`. The first unfiltered page request to `https://parameter-filter.superzoo.cz/filter-products/superzoo_sk` used that scope, price level `22`, and a limit of ten. It returned HTTP 403. Both requests were anonymous, with a 12-second timeout, no redirects, and no retries. The run stopped at the filter response. Cat litter facets and products remain unverified.

### Broader category browsing and combined facets — 2026-11-24

Both markets returned HTTP 200 for navigation, separate single-alias route lookups, parameter-filter pages, and product joins. Each exact route resolved to `productCatalogue:category:CATEGORY`. Both markets returned the same navigation ID and filter scope for each category. The Slovak cat litter filter returned HTTP 200 on this date. Requests were anonymous, used a 12-second deadline, and followed no redirects.

| Category | Navigation ID | Filter scope | Unfiltered total SK / CZ | Verified facet keys SK / CZ |
| --- | --- | --- | --- | --- |
| Wet dog food | `4a0f2a97-fe83-479e-b76d-65818f053d9b` | `57377452-e778-43d0-9853-870bd5116ad3` | 522 / 404 | `vek-psa` / `stari-psa` |
| Dry cat food | `4716d036-9322-41aa-975a-7a32a0735f0b` | `927e5be1-9bd3-4d53-b710-af2966dd3958` | 357 / 322 | `vek-macky` / `stari-kocky` |
| Cat litter | `dfc861d8-9069-47db-b29b-5d6afee06f1f` | `19291e00-26e0-464b-bd6a-b804296ffb14` | 79 / 76 | `typ-podstielky` / `typ-steliva` |

Separate first-page requests verified each of the three life stages for wet dog food and dry cat food, all five litter types, and grain-free dry dog food in each market. Each returned total matched the advertised facet count. Every candidate joined to a published, eligible product with a market price record and carried the requested value. Sampled second pages preserved the same filtered totals and had no overlap with page 1.

For dry dog food, `vek-psa=senior` plus `alergie-psa=bez-obilnin-grain-free` returned 66 matches in SK. In CZ, `stari-psa=senior` plus `alergie=bez-obilovin-grain-free-1` returned 70. Each market returned ten eligible products on each of the first two pages. All joined records carried both values, and the pages had no overlap. The same MCP tools now expose these categories and facets, using the existing paging and product eligibility rules.

Slovak kitten dry food page 2 returned ten candidate IDs, but the product read model returned nine records. A separate request for the missing variant, `1753-127737`, also returned an empty result. Browsing now skips candidates with missing records and can return the next page based on the upstream total. Duplicate, unexpected, and malformed product records still produce an error.

A plain JavaScript MCP client over stdio discovered all four categories in each market. It followed `next_page` for senior grain-free dry dog food, puppy wet food, kitten dry food, and clumping litter. All eight pairs of pages preserved the filters and had no overlapping IDs. The Polish server omitted both category tools. Typecheck, all 152 tests, the packed consumer install and MCP smoke test, and the npm pack dry run passed.

### Dry dog food pagination — 2026-11-24

At 10:56 Bratislava time, four sequential anonymous requests per market used the existing dry dog food filter scope, the local puppy facet, and the default upstream order. Each changed only `paging.page` and kept `paging.limit` at 10. Requests used a 12-second deadline, blocked redirects, and omitted credentials. All returned HTTP 200.

| Market | Upstream total on every page | Pages 1 and 2 | Last page | Next request |
| --- | ---: | --- | --- | --- |
| SK | 222 | 10 unique IDs each, zero overlap | Page 23, 2 candidates | Page 24, 0 candidates |
| CZ | 211 | 10 unique IDs each, zero overlap | Page 22, 1 candidate | Page 23, 0 candidates |

The upstream response provides `totalCount` and ordered candidates. It provides no continuation field. The observed boundary is `ceil(totalCount / 10)`. The total counts candidates before MCP eligibility checks. Results reflect the current catalog at each request.

A live plain JavaScript MCP client repeated the four page requests over stdio in each market. The first two pages each returned ten eligible products with no overlap. The final pages returned two eligible products in SK and one in CZ, with `next_page: null`. The requests past the final pages returned zero candidates, skipped the product join, and also returned `next_page: null`.

## Anonymous product shipping quotes and pickup — 2026-11-23

### APK trace

| Hermes references | Request and dependencies |
| --- | --- |
| `#59233`, `#54267–#54268`, `#15444`, `#15449`, `#54272`, `#14779` | The product availability panel asks for one unit through a read query. `POST https://logistics.superzoo.cz/api/actions/calculate-product-shipping-options` sends `{ webId, product: { productId, quantity } }`. The quote call passes no location, account, cart, or reservation input. The panel's add-to-cart action is separate. |
| `#15446–#15449`, `#54272` | The same logistics origin has a dedicated `GET /api/delivery/pickup-places` with an optional query object. The wrapper does not define the query keys. |
| `#59281–#59286`, `#31322`, `#33912` | The product panel also reads pickup-method metadata from `https://read-model.superzoo.cz/collections/personal-pickup/webs/{webId}/languages/{language}/documents` and joins the items to quote methods by `personalPickupId`. The APK uses `superzoo_sk` with `sk` and `superzoo_cz` with `cs`. |
| `#58768`, `#58774`, `#58777` | The checkout map and nearest pickup-place flows pass a basket hash and shipment hash to the storefront API. Checkout probes were skipped. |

### Anonymous probes

Five sequential HTTPS requests used a 12-second deadline, zero retries, and no redirect following, cookies, or credentials. Times are local to Europe/Bratislava. Both quote requests used public product `294-101115`, quantity `1`, and the locale's web ID.

| Time | Request | Result |
| --- | --- | --- |
| 15:44:52 | SK product quote | HTTP 200 JSON. Two home-delivery methods and four pickup-method records. Packeta home delivery, ID `eed7a79d-1dc4-430f-bccd-ca291c8caaef`, quoted `3.99 EUR` including VAT for `2026-11-25T13:00:00+01:00`. `PERSONAL_PICKUP_SK` returned 44 store places. |
| 15:44:52 | CZ product quote | HTTP 200 JSON. Three home-delivery methods and four pickup-method records. Zásilkovna home delivery, ID `23b3f7f3-17d6-4694-a5eb-9822de093d65`, quoted `99 CZK` including VAT for `2026-11-24T16:00:00+01:00`. `PERSONAL_PICKUP_CZ` returned 204 store places. |
| 15:46:39 | SK and CZ pickup-method catalog, one GET each | Both HTTP 200 JSON. Each returned `items` and `totalCount: 4`. The nested `personalPickup` records supplied method IDs, names and store flags. All four IDs matched the quote in each market. |
| 15:47:31 | Direct logistics pickup-place listing with no query | HTTP 401 JSON. The anonymous probe stopped at this response. Accepted query keys and authentication requirements remain unverified. |
| — | PL | The APK trace did not establish a Polish configuration for these routes. |

Each quote returned `shippingOptions.shipment.items` and `shippingOptions.items` echoing the requested product ID and quantity. `deliveryMethods` entries carry `deliveryMethodId`, localized `name`, `price.amountIncVat` as a decimal string, `price.currency`, `isPriceFrom`, and `deliveryDate`. Keep the quoted timestamp and the price qualifier. The timestamps describe market-level quotes. Address-specific availability and delivery commitments remain unverified.

Entries in `personalPickups` carry `personalPickupId`, `name`, `isStore`, price, nullable method-level `deliveryDate`, and `places`. Sampled places had their own `pickupPlaceId`, parent `personalPickupId`, `name`, `isAvailable`, `deliveryDate`, and nullable `extraFee`. Store methods listed available places and had a null method-level date. Express delivery also appeared in this upstream group with `isStore: false`. Packeta and Zásilkovna parcel-point and locker methods returned empty `places` arrays despite quoting method-level prices and dates. The sample verifies associated store places for one product. Carrier point coverage, unavailable-place behavior, and the meaning of the observed store pickup times remain unverified.

SK and CZ meet the Task 7 gate for a one-unit, market-level quote. The independent pickup-method catalog is a follow-up for localized method metadata. Standalone pickup-place listing remains unverified. Raw captures remain local.

## Two-unit delivery quotes — 2026-11-23

Two sequential anonymous requests to the same logistics quote endpoint used `productId: "294-101115"`, `quantity: 2`, and the configured market web IDs. Each request had a 12-second deadline, blocked redirects, and omitted credentials. Both returned HTTP 200. Both `shippingOptions.shipment.items` and `shippingOptions.items` contained exactly one entry with the requested variant ID and quantity.

| Time (Europe/Bratislava) | Market | Home delivery example (including VAT) | Pickup observations |
| --- | --- | --- | --- |
| 22:13:06 | SK (`superzoo_sk`) | Packeta home delivery quoted `3.99 EUR`, `isPriceFrom: false`, and `2026-11-26T10:00:00+01:00`. Two home-delivery methods and four pickup-method records. | Store pickup listed 42 places and express listed 22, all marked available. Packeta parcel points and Z-BOX had empty place lists and still supplied method prices and dates. |
| 22:13:06 | CZ (`superzoo_cz`) | Zásilkovna home delivery quoted `99 CZK`, `isPriceFrom: false`, and `2026-11-25T13:00:00+01:00`. Three home-delivery methods and four pickup-method records. | Store pickup listed 204 places and express listed 90, all marked available. Zásilkovna parcel points and Z-Box had empty place lists and still supplied method prices and dates. |

Store pickup and express records had null method-level dates and dated individual places. Both responses distinguish empty place lists from priced, dated methods. Neither sample contained an explicitly unavailable place or an empty method list, so those cases remain unverified live. The sampled home-delivery prices matched the earlier one-unit quotes. The echoed quantities confirm what the API quoted.

SK and CZ pass the Task 1 gate for quantities `1` and `2` of one variant. The initial implementation bound is `2`. Higher quantities and PL remain unverified.

## APK feature follow-ups — 2026-11-23

- **Feeding tables.** Hermes `#15680` reads a product-specific table, and `#59200` uses its `configuration` field. Verify an anonymous response per market and confirm how the source identifies the manufacturer before exposing feeding guidance.
- **Autocomplete.** Hermes `#15428` calls a locale-specific search suggestion route. Verify the anonymous response shape per market and identify a client that would use suggestions as the shopper types.
- **Exact EAN lookup.** The anonymous probe returned HTTP 403. Support remains unverified. `get_product` already returns `ean` when supplied for a known variant ID.

### Exact barcode lookup verification

The Super zoo 2.0.13 scanner builds a filter with the scanned `ean` and `published: true` (`#40542`). It passes that filter to the product read-model repository (`#40548`, `#40551`), whose `getFiltered` method uses `POST /collections/product/webs/{webId}/languages/{language}/documents/filter` (`#31317`, `#31326`). The earlier anonymous exact EAN probe returned HTTP 403. This review used saved bytecode and sent no new requests. Exact variant matching, no-match behavior, and anonymous market coverage remain unverified. `get_product` can still return the barcode when the variant ID is known.

### Feeding table verification — 2026-11-23

Saved Hermes disassembly from Super zoo 2.0.13 ties the storefront `/web-api` base (`#14779`) to `GET /products/{productId}/feeding-tables` (`#14895`, `#15669`, `#15680`). The caller passes a user ID when present and reads `configuration` from the result (`#59200`).

Four sequential GET requests used `www.superzoo.sk` and `www.superzoo.cz`, with a 12-second deadline per request, zero retries, and redirects disabled. They omitted the `userId` query parameter, credentials, and cookies. All returned HTTP 200 JSON. In both markets, public variant `294-170845` (Brit Premium by Nature Sensitive Lamb 15 kg in the saved CZ product read model) returned a table. Variant `294-101115` returned `{"configuration":null}`.

The table has one axis headed `Váha psa v dospelosti` in SK and `Váha psa v dospělosti` in CZ, with 12 weight labels from `5 kg` to `90 kg`. Each `values` row references its weight label by column ID. Both markets returned a default labelled `75 g`, and the `5 kg`, `10 kg`, and `90 kg` rows carried numeric `dailyDosage` values of `75`, `120`, and `630`. Individual rows carry no dosage unit field. The response has no echoed variant ID, manufacturer, or attribution for the table. The request path supplies the variant ID, and the saved brand ID identifies the product brand. Manufacturer authorship and row-level unit semantics remain unverified. This leaves the manufacturer feeding table tool blocked. Raw captures remain local.

### Public deal verification — 2026-11-24

Anonymous requests used the dry dog food category with adult and grain-free facets in SK and CZ. Turning on `promotedOnly` produced the same first page and total as the baseline in each market (157 SK, 168 CZ). Regular-price entries remained in both results. The flag cannot serve as a deals filter for this request.

The public detail endpoint returned `sale` for advertised general discounts in SK and `familyPrice` and `topPriceFamilySale` for discounted Family offers in both markets. For example, SK variant `0814-512200` returned EUR 21.59 against EUR 26.99 with `sale`. Variant `294-170771` returned EUR 7.69 against EUR 8.39 with `familyPrice`. Both unit-price fields were identical on these offers, so the published unit price cannot establish the discounted cost per kg.

The pack and unit sort requests changed catalogue order over two pages. The sampled order tracked the catalogue price-level record, which can differ from the advertised offer. For example, SK variant `294-172210` had a catalogue comparison price of EUR 63.69 and an advertised Family offer of EUR 57.90. Some CZ candidates had missing price details. Global deal ranking requires evidence that catalogue sorting tracks the public offer and comparable unit prices across pages.

The deal filter therefore checks the public detail for each eligible candidate on the requested catalogue page. It matches recognized variants only when the published offer amount is lower than the published original amount. The result retains Family membership context, published unit amounts, and the existing catalogue continuation.

A plain JavaScript MCP client discovered the adult and grain-free facets and requested two deal pages over stdio in each market. Slovakia returned four offers on page 1 and three on page 2. Czechia returned one and two, respectively. Each page started with ten eligible candidates and had zero failed detail checks. In Slovakia, the first page included variant `0814-512200` at EUR 21.59 with `sale`. In Czechia, the first page included variant `94-11374` at CZK 789 with `familyPrice`.

## APK feature release smoke — 2026-11-23

The live check called the two new MCP tools in SK and CZ with one sequential anonymous request per market and tool. Requests had a 12-second deadline, zero upstream retries, and redirect following disabled. The locator used public city-center coordinates. Delivery used one unit of public variant `294-101115`. Results validated against the published MCP success schemas.

| Market | `find_stores` | `get_delivery_options` |
| --- | --- | --- |
| SK | HTTP 200, one branch | HTTP 200, two delivery methods, four pickup methods, 66 associated places across all pickup methods |
| CZ | HTTP 200, one branch | HTTP 200, three delivery methods, four pickup methods, 296 associated places across all pickup methods |

PL locator and delivery quotes remain unverified. Earlier APK review probes returned HTTP 403 on product detail routes, so this pass left those live routes closed. Product enrichment was checked against saved evidence and fixtures in the deterministic suite. The [release checklist](superpowers/plans/2026-11-23-apk-inspired-mcp-features.md#task-8--record-smaller-leads-and-verify-the-delivered-release) records the package gates and remaining evidence gaps.

## Shopping follow-up release check — 2026-11-23

The README examples and Unreleased changelog match the tested contracts. SK and CZ advertise delivery quotes with a one-unit default and a two-unit maximum, plus category tools for the first page of dry dog food with the local dog-age facet. The tests cover the omitted quantity and the structured result. PL discovery excludes the quote and category tools.

| Command | Result |
| --- | --- |
| `npm run typecheck` | Passed. |
| `npm test` | 149 passed with localhost access for HTTP transport tests. |
| `npm run test:package` | 1 passed. The packed npm package installed and served MCP through its executable. |
| `npm pack --dry-run` | 13 files, including the compiled runtime and entry point, `package.json`, `README.md`, and `LICENSE`. |

Live evidence came from the earlier [one-unit quotes](#anonymous-product-shipping-quotes-and-pickup--2026-11-23), [two-unit quotes](#two-unit-delivery-quotes--2026-11-23), and first-page category probes in [SK](#slovak-dry-dog-food-category-filter--2026-11-23) and [CZ](#verified-czech-dog-food-category-filter--2026-11-23). This release check used fixtures for upstream calls. Manufacturer feeding tables remain blocked on attribution, exact barcode lookup remains deferred after HTTP 403, and broader browsing remains blocked on live category evidence.

## Catalogue-wide filter discovery — 2026-11-24

See the [filter investigation](catalogue-filter-investigation.md) and [inventory](catalogue-filter-inventory.jsonl) for APK request fields, live parameter values, category coverage across all six animal departments, and the Polish verification gap.
