# Persona AI v3.1.1 hardening architecture

This release hardens Persona AI without redesigning the product or changing its persistent schema.

## Source and build model

The repository previously contained only the generated self-contained `index.html`. To avoid a risky rewrite, v3.1.1 introduces maintainable source only for the systems touched by the hardening release:

- `src/hardening/runtime.mjs` — secret policy, SecretStore, sanitization, legacy-settings migration, backup payload policy, endpoint validation, and safe OpenAI-compatible transport.
- `scripts/build.mjs` — deterministic/idempotent integration of the source hardening runtime into the existing self-contained bundle.
- `scripts/enforce-hardening-policy.mjs` — post-build invariants for restore/safety-backup ordering, reset secret-clearing postconditions, and single-file runtime dependency enforcement.
- `tests/security-hardening.test.mjs` and `tests/import-policy.test.mjs` — executable security and regression tests.
- `scripts/verify.mjs` — static production-artifact verification and inline-script syntax compilation.
- `scripts/browser-smoke.mjs` — dependency-free real Chromium/Chrome acceptance test using the DevTools protocol.
- `.github/workflows/hardening.yml` — CI build, security tests, production verification, browser certification, and generated-bundle commit for hardening branches.

The existing product bundle is deliberately not decomposed wholesale in this patch. Future modularization can proceed incrementally from this source/build foundation.

## Commands

```bash
npm run build
npm test
npm run verify
npm run test:browser
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

The browser gate uses only the Chrome DevTools protocol available on the CI runner; no Playwright, Puppeteer, CDN, or new runtime dependency is introduced.

## Verification boundary

The following are verified in CI: deterministic build, 17 unit/security/regression tests, production static/syntax verification, real Chrome direct-file startup, real Chrome HTTP-hosted startup, legacy persistent-settings migration, current-session SecretStore behavior, real IndexedDB secret scrub persistence, Settings security UX, Local-mode network isolation, and no unexpected runtime asset dependency.

A live call to a third-party external AI provider remains provider/environment-specific because endpoint availability, credentials, browser CORS policy, rate limits, and provider response format are outside the repository. The transport itself is covered by deterministic request/auth/error tests, and browser certification proves no external transmission occurs until an external analysis operation is explicitly invoked. Do not represent an arbitrary third-party live provider/CORS integration as universally verified without testing that specific configured provider.
