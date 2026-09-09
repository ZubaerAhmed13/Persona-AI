# Persona AI v3.1.1 hardening architecture

This release hardens Persona AI without redesigning the product or changing its persistent schema.

## Source and build model

The repository previously contained only the generated self-contained `index.html`. To avoid a risky rewrite, v3.1.1 introduces maintainable source only for the systems touched by the hardening release:

- `src/hardening/runtime.mjs` — secret policy, SecretStore, sanitization, legacy-settings migration, backup payload policy, endpoint validation, and safe OpenAI-compatible transport.
- `scripts/build.mjs` — deterministic/idempotent integration of the source hardening runtime into the existing self-contained bundle.
- `tests/security-hardening.test.mjs` — executable security and regression tests.
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

Existing users with `settings.aiApiKey` are migrated idempotently: the value may be copied to SecretStore for the current session, then is immediately removed from persistent settings. Legacy backup credentials are discarded rather than restored.

## Backup policy

Normal JSON, encrypted JSON, and pre-import safety backups now use the same canonical payload builder. Metadata includes application identity, application version, schema version, export-format version, and timestamp. The application version is sourced from `APP_VERSION`; the obsolete hard-coded backup version is removed.

Encrypted backups keep the existing PBKDF2/SHA-256 + AES-GCM implementation. Encryption is not used as a credential vault: the plaintext Persona payload is credential-free before encryption.

## External AI policy

Remote endpoints require HTTPS. Plain HTTP is accepted only for loopback development endpoints (`localhost`, `127.0.0.1`, `[::1]`). Malformed URLs and non-HTTP(S) schemes are rejected before a request is sent.

The Authorization header is constructed only for the request and is not logged. Network, HTTP, malformed-JSON, and unexpected-response failures return safe messages without echoing credentials. Local mode never invokes the external transport helper.

## Version matrix

| Component | v3.1.1 value |
| --- | --- |
| Application | 3.1.1 |
| Schema | 7 (unchanged) |
| Analytics engine | 3.1 (unchanged) |
| AI engine | 2.1 (unchanged) |
| Export format | 3.1 (unchanged) |

## Verification boundary

CI executes deterministic unit/security tests and production static/syntax checks. A real browser/device direct-open session, live GitHub Pages deployment, live provider/CORS behavior, and a real pre-existing browser IndexedDB database still require environment-level acceptance testing; those must be reported as NOT VERIFIED until actually exercised.
