# Persona AI v3.1.1 hardening architecture

This release hardens Persona AI without redesigning the product or changing its persistent schema.

## Source and build model

The repository previously contained only the generated self-contained `index.html`. To avoid a risky rewrite, v3.1.1 introduces maintainable source only for the systems touched by the hardening release:

- `src/hardening/runtime.mjs` — secret policy, SecretStore, sanitization, legacy-settings migration, backup payload policy, endpoint validation, and safe OpenAI-compatible transport.
- `scripts/build.mjs` — deterministic/idempotent integration of the source hardening runtime into the existing self-contained bundle.
- `scripts/enforce-hardening-policy.mjs` — post-build invariants for restore/safety-backup ordering, reset secret-clearing postconditions, and single-file runtime dependency enforcement.
- `scripts/fix-functional-tags.mjs` — deterministic post-build functional corrections for modal tag/context controls and consistent memory completion behavior.
- `tests/security-hardening.test.mjs` and `tests/import-policy.test.mjs` — executable security and regression tests.
- `tests/fixtures/v3.1-full-backup.json` — representative schema-v7/v3.1 compatibility fixture covering every production IndexedDB store.
- `scripts/verify.mjs` — static production-artifact verification and inline-script syntax compilation.
- `scripts/browser-smoke.mjs` — dependency-free real Chromium/Chrome acceptance test using the DevTools protocol.
- `scripts/full-browser-acceptance.mjs` — full production browser acceptance for compatibility import, product routes, core CRUD/search, local-analysis isolation, normal backup/reset/restore, mocked external AI, and encrypted backup/reset/restore.
- `scripts/feature-workflow-acceptance.mjs` — browser-driven regression coverage for major feature lifecycles including interactions, memories, commitments, predictions, follow-ups, reviews, relationship goals, experiments, playbook strategy/update, situation intelligence, and signal processing.
- `.github/workflows/hardening.yml` — CI build, security tests, production verification, browser certification, full acceptance, feature-workflow acceptance, and generated-bundle commit on both hardening branches and direct `main` pushes.
- `.github/workflows/deploy-live.yml` — post-hardening `main` deployment of the exact certified `index.html` to the deployment-only `gh-pages` branch, followed by live GitHub Pages byte verification and real-Chrome smoke.

The existing product bundle is deliberately not decomposed wholesale in this patch. Future modularization can proceed incrementally from this source/build foundation.

## Commands

```bash
npm run build
npm test
npm run verify
npm run test:browser
npm run test:acceptance
npm run test:features
npm run check
```

No runtime dependencies, backend, CDN, or development server are required. The final production artifact remains `index.html` and remains suitable for direct-file use and GitHub Pages hosting.

## Secret policy

The external-AI API key is not an application setting anymore. It is stored only in `sessionStorage` under:

`persona.secret.aiApiKey.session`

If `sessionStorage` is unavailable, Persona falls back to process/page memory only. It never falls back to persistent `localStorage` or IndexedDB.

The serialization/storage policy strips centrally classified credential fields from:

- persistent settings
- IndexedDB-shaped records loaded by the app
- normal backup payloads
- encrypted-backup plaintext payloads
- imported legacy data before persistence

Existing users with `settings.aiApiKey` are migrated idempotently: the value may be copied to SecretStore for the current session, then is immediately removed from persistent settings. Legacy backup credentials are discarded rather than restored. Reset clears SecretStore both before and after the legacy-settings load/sanitization path, giving reset a strict no-secret postcondition.

## Backup policy

Normal JSON, encrypted JSON, and pre-import safety backups use the same canonical payload builder. Metadata includes application identity, application version, schema version, export-format version, and timestamp. The application version is sourced from `APP_VERSION`; the obsolete hard-coded backup version is removed.

The normal-import safety backup is captured and downloaded before imported settings or records replace the current state, and the backup itself is secret-free. Only after that safety snapshot does Persona clear the current session credential and apply sanitized imported settings.

Encrypted backups keep the existing PBKDF2/SHA-256 + AES-GCM implementation. Encryption is not used as a credential vault: the plaintext Persona payload is credential-free before encryption.

## External AI policy

Remote endpoints require HTTPS. Plain HTTP is accepted only for loopback development endpoints (`localhost`, `127.0.0.1`, `[::1]`). Malformed URLs and non-HTTP(S) schemes are rejected before a request is sent. URL userinfo and credential-like query parameters are also rejected so provider credentials cannot be hidden in or persisted as part of `aiEndpoint`.

The Authorization header is constructed only for the request and is not logged. Network, HTTP, malformed-JSON, and unexpected-response failures return safe messages without echoing credentials. Local mode never invokes the external transport helper.

## Single-file runtime policy

Persona v3.1.1 is a genuine single-file runtime artifact. Browser certification found that the historical bundle still attempted to register an unshipped `service-worker.js` under HTTP hosting, producing a guaranteed 404 despite the product being deployed as only `index.html`. The v3.1.1 hardening build removes that orphaned registration. No external JavaScript, stylesheet, or service-worker asset is required at runtime.

## Functional corrections discovered by acceptance testing

The expanded browser workflow exposed two product-level inconsistencies and they are now part of the deterministic build:

- modal tag/context groups are given the IDs already expected by form save handlers, and modal tag groups are bound across the document rather than only inside the main view root; this makes real Interaction/Person modal tag selection both clickable and persistable.
- the dedicated Memory workspace now exposes the same active-memory completion/check-in action as the person-profile workflow even when no optional reminder date exists, so memory lifecycle behavior is consistent across views.

## Version matrix

| Component | v3.1.1 value |
| --- | --- |
| Application | 3.1.1 |
| Schema | 7 (unchanged) |
| Analytics engine | 3.1 (unchanged) |
| AI engine | 2.1 (unchanged) |
| Export format | 3.1 (unchanged) |

## Deployment model

The `gh-pages` branch remains a deployment-only branch containing the self-contained `index.html`. Source, tests, and build scripts stay on `main` and are not copied into the Pages branch.

A successful `Persona hardening verification` run on a direct `main` push triggers `Deploy certified Persona to GitHub Pages`. That workflow rebuilds and re-runs the complete certification suite, creates a deployment-only commit containing the exact certified `index.html`, fast-forwards `gh-pages`, waits for GitHub Pages deployment, verifies the live response bytes match the certified bundle, and then executes a real-Chrome live URL smoke test.

## Browser certification

`npm run test:browser` launches real headless Chromium/Chrome and exercises the generated production `index.html` in both supported delivery modes:

- direct `file://` open
- HTTP-hosted open equivalent to the GitHub Pages delivery model
- visible application startup and Persona UI rendering
- legacy `localStorage` API-key migration into the dedicated current-session secret entry
- proof that the raw key is absent from persistent settings
- actual IndexedDB schema/store availability
- a real secret-bearing legacy IndexedDB record followed by application reload, proving secret removal is persisted back to IndexedDB while benign record data survives
- Settings navigation and External API configuration visibility
- proof that the password field never renders the raw session secret
- visible session-only/external-processing security disclosure
- explicit Clear API key behavior
- zero external network requests during Local mode startup, IndexedDB scrub reload, and mere selection of External API configuration
- uncaught runtime/browser-console error checks

The browser gate uses only the Chrome DevTools protocol available on the CI runner; no Playwright, Puppeteer, CDN, or new runtime dependency is introduced. The CI wrapper permits one bounded retry of this basic smoke only when the first invocation exits non-zero, protecting against the observed hosted-runner Chrome `DevToolsActivePort` startup flake while still requiring a successful browser run.

## Full product acceptance

`npm run test:acceptance` drives the actual production UI in real Chrome. It verifies:

- the complete 33-store schema-v7/v3.1 compatibility fixture through production import
- representative restored records in all production stores, including audit-log compatibility
- rendering of every product navigation route without runtime exceptions
- core browser CRUD/search behavior
- the real local decision-analysis action with zero provider-network requests
- normal production JSON export, production reset, production restore, and canonical database round-trip equality
- External API configuration through the real Settings UI against a loopback mocked OpenAI-compatible endpoint
- one real browser AI operation with the expected POST/auth semantics and no credential leakage to URL, persistent storage, or console
- production encrypted export, production reset, production decrypt/restore, canonical database equality, and proof that the session API credential is not restored

`npm run test:features` adds lifecycle-level regression coverage across the product's major feature workflows. It does not only render routes: it creates, updates, resolves, deletes, reviews, compares, and derives records through the real application UI and then verifies IndexedDB persistence or derived output.

## Verification boundary

The following are verified in CI: deterministic build, 17 unit/security/regression tests, production static/syntax verification, real Chrome direct-file startup, real Chrome HTTP-hosted startup, legacy persistent-settings migration, current-session SecretStore behavior, real IndexedDB secret scrub persistence, Settings security UX, Local-mode network isolation, all 33 production stores through a full v3.1 compatibility fixture, production JSON and encrypted backup/reset/restore round trips, browser-level mocked external-AI request/auth behavior, all product navigation routes, core CRUD/search, and major feature workflows including playbook/situation/signal derivation.

A live call to an arbitrary third-party external AI provider remains provider/environment-specific because endpoint availability, credentials, browser CORS policy, rate limits, and provider response format are outside the repository. The transport itself is covered by deterministic request/auth/error tests and by a browser-level mocked OpenAI-compatible operation. Do not represent an arbitrary third-party live provider/CORS integration as universally verified without testing that specific configured provider.

Repository branch-protection settings are an administrative GitHub control rather than application code. The connected GitHub integration used for this hardening work does not have repository-administration permission, so branch protection must be enabled by a repository owner/admin separately if required.