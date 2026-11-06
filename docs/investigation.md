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

A limit of 200 was accepted by the service. Result items can include brands despite the `types` parameter, so filter locally and never describe `totalCount` as a product count. Attributes contain arrays such as `productSaleForbidden: ["false"]` and `disallowedPriceLevels: []`. Search pagination and a reliable server-side product-only filter remain unverified.

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
