# Contributing

Use Node.js 22 or newer. Install with `npm ci`, then run `npm run typecheck` and `npm test` (which builds automatically). Tests use small public-data fixtures and local HTTP listeners; they do not call Super zoo.

Keep runtime source in strict TypeScript under `src/`. Use `.js` specifiers for relative ESM imports; TypeScript resolves them to the source modules and emits working Node.js imports. Infer upstream data types from Zod schemas instead of duplicating them or introducing `any`. Keep runtime validation at trust boundaries. JavaScript tests exercise compiled `dist/` modules; generated output must not be committed. Preserve existing tool arguments and document response changes. Add regression tests for behavior changes. Test HTTP transport changes with a real MCP client.

For a new market, verify the official shop domain, language, currency, search mutation, sale restrictions, product detail and store availability endpoints. Add the fixed configuration and contract tests. Do not guess a default price level or add arbitrary upstream URL configuration.

`SUPERZOO_COUNTRY=CZ npm run smoke` runs a small live check. Change the country to SK or PL to test the other markets. Keep live requests bounded; never run them in routine CI.

Do not commit credentials, account data, downloaded apps, decompiled app code, or local machine paths. Keep local research in `.local/`. Fixtures should contain only the public facts needed to test the API contract, without copied product descriptions or unrelated response fields.

Open a GitHub issue for reproducible bugs or a pull request with a short description and test results. For security issues, follow SECURITY.md. This project is unofficial; it does not own Super zoo trademarks, product images, or descriptions.

## Publishing to npm

Add an npm granular access token as the GitHub Actions repository secret `NPM_TOKEN`. It must allow publishing `superzoo-mcp`; for the first release, it must allow creating the package under your npm account. Enable bypass 2FA on the token so publishing does not require an interactive code. Keep the token limited to the required package and renew it before expiry.

`package.json` is the source of truth for the package and MCP server version. To prepare a release:

1. Run `npm version patch --no-git-tag-version` (or `minor` / `major`). npm updates `package.json` and both root version entries in `package-lock.json`; do not edit dependency versions in the lockfile.
2. Move the changes under **Unreleased** in `CHANGELOG.md` into a section for the new version and release date. Add its release link and update the Unreleased comparison link to start from the new tag. Keep historical version numbers unchanged.
3. Run `npm run typecheck`, `npm test`, and `npm run test:package`, then commit and push the package files, changelog, and any release changes.
4. Read the exact tag from the package version with `node -p "'v' + require('./package.json').version"`. Create a stable GitHub release with that tag pointing to the tested commit.

The MCP handshake reads the version from the installed package's `package.json`, including in Docker. No runtime source version needs updating. Versions in test client identities are independent of the server version.

Publishing a stable GitHub release runs `.github/workflows/publish.yml`: it checks the tag against `package.json`, installs locked dependencies, typechecks, tests, inspects the package contents, and publishes a public package with npm provenance. Drafts and prereleases do not publish. A version already on npm cannot be overwritten; publish a new version for changes.
