# Persona AI v3.1.1 hardening architecture

This release hardens Persona AI without redesigning the product or changing its persistent schema.

## Source and build model

The repository previously contained only the generated self-contained `index.html`. To avoid a risky rewrite, v3.1.1 introduces maintainable source only for the systems touched by the hardening release:

- `src/hardening/runtime.mjs` — secret policy, SecretStore, sanitization, legacy-settings migration, backup payload policy, endpoint validation, and safe OpenAI-compatible transport.
- `scripts/build.mjs` — deterministic/idempotent integration of the source hardening runtime into the existing self-contained bundle.
- `scripts/enforce-hardening-policy.mjs` — post-build invariants for restore/safety-backup ordering and reset secret-clearing postconditions.
- `tests/security-hardening.test.mjs` and `tests/import-policy.test.mjs` — executable security and regression tests.
- `scripts/verify.mjs` — static production-artifact verification and inline-script syntax compilation.
- `.github/workflows/hardening.yml` — CI build/test/verification and generated-bundle commit for the hardening branch.

The existing product bundle is deliberately not decomposed wholesale in this patch. Future modularization can proceed incrementally from this source/build foundation.

## Commands

```bash
npm run build
npm test
npm run verify
npm run check
```

No runtime dependencies, backend, CDN, or development server are required. The final production artifact remains `index.html` and remains suitable for direct-file use where the browser supports Persona's existing storage features and for GitHub Pages hosting.

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

## Verification boundary

CI executes deterministic unit/security tests and production static/syntax checks. The deployment branch can be verified byte-for-byte against the tested `main` `index.html`. A real browser/device direct-open interaction session, live provider/CORS behavior, and a real pre-existing browser IndexedDB database still require environment-level acceptance testing and must be reported as NOT VERIFIED until actually exercised.
