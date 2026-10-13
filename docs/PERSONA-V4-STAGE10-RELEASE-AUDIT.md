# Persona AI 4.0 — Stage 10 Final Release Audit and Quality Gates

**Scope:** The v4 experience built through Stages 1–9, on the existing local-first Persona AI v3.1.1 data/backup compatibility identity. The v4 roadmap and interface do **not** silently change the IndexedDB version, record schema, or export format.

## Findings, corrections and protections

| Area | Verified baseline / remediation | Release evidence |
|---|---|---|
| Data integrity | 33 IndexedDB stores, 34 historical view handlers, unchanged IDs; JSON/encrypted backup restore and reset remain atomic | Contract tests, data safety tests, real Chrome round-trips |
| Credentials | API key stays in session-only SecretStore, not persisted with ordinary settings or backups; direct-file fallback works | Existing security unit/browser suites |
| Prototype safety | Imported/backup object keys `__proto__`, `constructor`, and `prototype` are now excluded before assigning sanitized objects | New malicious-JSON prototype-pollution unit test |
| Local/offline | No new network resource dependency, CDN, font or external stylesheet; no orphan service worker | `scripts/verify.mjs` and Stage 10 release gate |
| Reproducible release | A second complete source build must produce *identical* bytes and SHA-256 to the first generated `index.html` | `scripts/release-gate.mjs` required by hardening CI |
| Bundle-size visibility | Check a max 1.4 MB raw and 450 KB gzip *regression budget*; report exact bytes, compression and SHA-256 | Printed release-gate metrics, not a guarantee of fast performance on every device |
| Accessible interaction | Mobile viewport checks at 320, 390 and 720px; modal focus, Escape, return of focus, reduced motion, nav targets | Stage 9 headless-Chrome acceptance |
| Personal inference | Local Copilot citations and explicit optional remote consent; network does not fabricate person-to-person ties | Stage 7/8 unit and browser tests |
| Pages deployment | The production workflow pins the certified main source and waits for exact public bytes before live Chrome smoke | `.github/workflows/deploy-live.yml` |
| Supplemental Pages check | Fixed a *real stale-hash bug*: separate smoke workflow had hard-coded an older 863,903-byte blob, which could reject new releases incorrectly. It now calculates expected SHA, byte count and version from current checked-out `main`; PRs syntax-check the harness rather than comparing unreleased changes with production | `.github/workflows/live-pages-smoke.yml` plus release-policy tests |

## Reproduction

Run locally with Node 24 and Chrome/Chromium:

```bash
npm run check
```

That includes build, static/data/security tests, production file syntax verification, direct-file and localhost Chrome smoke, complete product/backup/AI acceptance, major feature acceptance, and the new deterministic release-quality gate.

For the separate final check:

```bash
npm run release:gate
```

The gate inspects the existing generated bundle, measures raw/gzip sizes, confirms required data/privacy/runtime markers and rebuilds using every production build stage to require byte-for-byte identical output. It neither reads the user's real IndexedDB nor contacts any external endpoint.

## Data preservation and compatibility

- **Do not** reset or delete personal records as part of a UI release.
- Keep `DB_NAME=persona-ai`, IndexedDB database version 5, record schema 7, the historical 33 store names and record ID links.
- Keep both the legacy plaintext and encrypted backup formats compatible. A formatted export has metadata version 3.1.1 / export format 3.1 even though the **product redesign initiative is v4.0**.
- The app is deployed as one `index.html` via GitHub Pages; existing local data resides in the same browser/origin, not inside GitHub.
- Export a backup before clearing a browser profile, changing origins, or destructive storage actions. A new browser/device will not automatically contain another device's records.

## Manual verification still required

Automated Chromium checks **do not** constitute WCAG certification or physical-device verification. Before claiming those things, manually check VoiceOver on Safari/iPhone, TalkBack on Android, 200% text zoom, high contrast, keyboard-only reading order, forms at 320px, slow mobile hardware, and browser-private/offline operation. Distinguish any manual failures from the automated release gate.

Likewise, the bundle-size budget is not a Core Web Vitals benchmark. Record real device startup and input latency to establish empirical performance targets before claiming high-performance certification.

## Rollback

The deployment workflow publishes a single verified-file tree on `gh-pages` only after the main branch's CI succeeds. For a faulty release, roll back by **re-publishing a known good certified commit/artifact** via the existing deployment safeguards; do not replace the user's IndexedDB records or import an older schema into production as a rollback shortcut. Re-run the live byte-identical Pages/Chrome tests for the rollback and keep a fresh user backup before any data-migration recovery.

## Non-goals and honest boundaries

This release does not build a novel trained LLM, global cloud sync, background push, calendar integration, or an account/login backend. Optional external AI actions outside the new Copilot evidence desk keep their separately activated existing provider behavior; Stage 7's *per-request context preview* does not universally wrap every legacy AI control. No user data should ever be committed into this public repository.

**Stage 10 completion rule:** passing branch tests alone is insufficient. Require independent PR green, merge, post-merge main certification, and a successful live Pages exact-artifact plus Chrome smoke. Only then call the automated release deployed. Keep outstanding manual-device testing clearly marked.

## Measured release candidate, October 13, 2026

Development-branch [certification #38455073980](https://github.com/ZubaerAhmed13/Persona-AI/actions/runs/38455073980) completed successfully: **1,002,047 raw bytes; 226,289 gzip bytes (22.6% of raw); 33 stores; 34 legacy view handlers; byte-for-byte repeat-build verified**. These are *packaging measurements*, not network Core Web Vitals or a physical-device benchmark. The generated artifact SHA-256 was `1cb8da61d057e5adf5a9f2f6fd6c2feef34d256956eb12962e9cba6767ca59bf`. Independent PR and main/deployment gates remain mandatory.
