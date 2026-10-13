# Persona AI 4.0 — Stage 1: Audit, compatibility contract, and safe modernization plan

> **Implementation brief / fully detailed Prompt 1.** This document is the authoritative Stage 1 handoff. It is grounded in the actual repository at baseline commit `da080c8739271dd6b87a0f822f85409c82e69da5` (2026-09-10), not a hypothetical application.

## Mission

Prepare the existing Persona AI v3.1.1 product for a carefully staged 4.0 user-experience and intelligence upgrade. **Do not redesign the interface, replace its core architecture, modify production storage, deploy, or remove features during Stage 1.** Establish a reproducible inventory and automated guards so later changes have a clear rollback path.

Success means a future developer can identify the application's core contracts, run existing validation, understand where data is stored, and determine whether a proposed UI or AI improvement threatens functionality or existing user data.

## Existing application: verified source-level baseline

| Property | Current value / observation |
| --- | --- |
| Repository | `ZubaerAhmed13/Persona-AI` |
| Branch and pinned starting SHA | `main` / `da080c8739271dd6b87a0f822f85409c82e69da5` |
| Application version | 3.1.1 |
| Storage database | IndexedDB, `persona-ai` |
| IndexedDB version | 5 |
| Record schema version | 7 |
| Export format version | 3.1 |
| Analysis engine marker | 3.1 |
| AI engine marker | 2.1 |
| Persistence | 33 IndexedDB stores; `localStorage` settings and metadata |
| Secret storage | Session-only API key with memory fallback; hardened v3.1.1 runtime |
| Deployment artifact | Self-contained `index.html`, ~864 KB |
| Runtime hosting | Direct local file or GitHub Pages; no app backend required |
| Source organization | Main product JavaScript and CSS bundled into `index.html`; hardening logic in `src/hardening/runtime.mjs` |
| Product navigation | 34 registered view handlers |
| Existing tests | Node unit/security/import tests; production verification; Chrome smoke, acceptance and feature workflow scripts |
| CI/CD | Hardening verification on PRs to main; successful main verification followed by certified GitHub Pages deployment |
| Actual AI boundary | Local analytical engine plus optional OpenAI-compatible external API; **not** an independent trained language model |

**Important distinction:** 33 stores are not 33 independent databases. The IndexedDB version (`5`) and application record schema version (`7`) describe different compatibility layers; do not casually make them equal or change either.

## Architecture inventory

### Canonical current files

- `index.html`: full offline product, UI markup, CSS variables, responsive layout, route registry, IndexedDB access, analytics, capture and intelligence logic.
- `src/hardening/runtime.mjs`: exported sanitization, API-key SecretStore, backup payload construction, legacy migration, external endpoint validation and transport helpers.
- `scripts/build.mjs`: deterministic post-generation integration of the hardened runtime into `index.html`. This script patches a bundled product; it is **not** a full source compiler for a modularized app.
- `scripts/fix-functional-tags.mjs`: targeted functional corrections.
- `scripts/enforce-hardening-policy.mjs`: hardening invariants.
- `scripts/verify.mjs`: source markers and production inline-script syntax verification.
- `scripts/browser-smoke.mjs`: direct-file and hosted-Chromium behavior.
- `scripts/full-browser-acceptance.mjs`: import, routes, real UI, CRUD/search, JSON/encrypted backup, reset/restore, mock provider.
- `scripts/feature-workflow-acceptance.mjs`: major intelligence and relationship workflows.
- `tests/security-hardening.test.mjs` and `tests/import-policy.test.mjs`: existing unit / regression tests.
- `tests/fixtures/v3.1-full-backup.json`: historic, credential-free full-backup fixture containing all 33 stores.
- `tests/upgrade-baseline-contract.test.mjs`: Stage 1 regression guard for the existing compatibility surface.
- `.github/workflows/hardening.yml`: automated quality gate.
- `.github/workflows/deploy-live.yml`: exact certified artifact publication and smoke test.

### Current user-facing routes

**Daily:** `dashboard`, `copilot`, `openloops`, `decisions`, `people`, `memory`, `commitments`, `judgment`, `weekly`, `monthly`.

**Intelligence:** `playbook`, `situations`, `signals`, `decisionlab`, `experiments`.

**Analysis:** `interactions`, `journal`, `patterns`, `reciprocity`, `reliability`, `communication`, `initiative`, `boundaries`, `conflict`, `support`, `context`, `preferences`, `predictions`.

**System:** `relationships`, `reports`, `data`, `settings`, `privacy`, `help`.

These 34 route identifiers are a feature compatibility contract, not a request to preserve 34 sidebar buttons forever. Stage 2 may reorganize the navigation while keeping route destinations and keyboard/mobile accessibility.

### Persistent record stores (33)

`people`, `interactions`, `observations`, `favors`, `commitments`, `predictions`, `preferences`, `boundaryEvents`, `conflictEvents`, `supportEvents`, `statements`, `memories`, `decisions`, `weeklyReviews`, `selfReflections`, `followUps`, `reminders`, `surprises`, `changeOfMinds`, `monthlyReviews`, `auditLog`, `openLoops`, `expectations`, `debriefs`, `lessons`, `playbooks`, `playbookHistory`, `signals`, `signalHistory`, `situations`, `experiments`, `decisionOptions`, `relationshipGoals`.

The historical fixture is a **compatibility test input**, not production user data. Do not overwrite or “upgrade” it in place merely to make a future test pass.

### Critical invariants for every later stage

1. Existing records survive updates, upgrades, imports, browser reloads, and theme changes. No silent wiping, resetting, schema renaming, or invented migration.
2. Every intentional schema change has an explicit, versioned migration; representative old data fixtures; backup-first strategy; and forward-compatibility tests. Keep rollback and recovery instructions.
3. Every existing workflow remains accessible after navigation redesign; hiding a route inside an Advanced workspace is allowed, removing its implementation without permission is not.
4. Offline/local mode continues to work and does not silently make network requests. External AI is explicit opt-in, with a clear disclosure of the context sent.
5. Session secrets are not persisted into regular settings, records, audit logs, exports, crash logs, or either plain/encrypted backup payloads.
6. Existing encrypted and normal backup formats remain readable. Export format changes require explicit tests for older files.
7. Account login, server synchronization, and end-to-end encryption **do not currently exist as established product capabilities**. Do not imply them from the GitHub Pages deployment.
8. Keep direct-file startup and deployed hosting working until a deliberate, separately tested architecture decision changes supported delivery modes.
9. All intelligence-based output must distinguish recorded observations from speculation, cite source records where practical, and avoid diagnosis or deterministic claims about a person's motives.
10. No secrets, sensitive user data, contact information, or non-anonymized relationship notes may be committed to this public repository.

## Stage 1 engineering tasks

### A. Baseline and inventory (completed source-level review)

- Inspect repository structure, current versions, build scripts, the view-handler map, navigation controls, storage declarations, fixture, security primitives, and CI workflows.
- Record what is truly implemented versus advertised in comments or docs.
- Identify old-path dependencies and hidden compatibility points: browser storage keys, form actions, view IDs, dynamic data attributes, export format, settings migration, and IndexedDB indexes.
- Record the route count, store count, and high-risk files.

### B. Freeze a compatibility contract (Stage 1 implementation)

Add `tests/upgrade-baseline-contract.test.mjs`, automatically executed by the existing `npm test` script (which already uses `tests/*.test.mjs`). It must:

- Check current database name/version, record schema, app version, export version, and settings storage key.
- Check the exact 33-store contract against the existing backup fixture.
- Check that all 34 product view handlers exist **without locking the future sidebar layout**.
- Check the major capture actions, search/context controls, backup entry points, hardening runtime and self-contained asset policy.
- Read production files without mutating storage or modifying the built HTML.
- Fail with useful messages when a future stage accidentally deletes a feature or changes a data contract.

When a later architecture intentionally replaces the bundled handler map, replace the test's source parser **only after** adding equivalent behavioral coverage. Never delete the feature assertions simply to make CI green.

### C. Build migration-ready architecture plan (documented, not yet executed)

Use the existing `index.html` as a compatibility baseline. Design a gradual split into independently testable modules:

1. **Shell/navigation** — app shell, desktop sidebar, mobile bottom bar, search, modal focus and keyboard access.
2. **Design system** — CSS tokens, themes, typography, button/input/card primitives; maintain light/dark/system modes.
3. **Domain data** — repository/service boundaries for people, interactions, notes/memories, follow-ups, commitments and predictions.
4. **Import/export and migrations** — canonical backup schema, storage validation, non-destructive migrations and rollback.
5. **Intelligence** — evidence retrieval and provenance, separation of observed vs inferred information, local engine.
6. **AI transport** — external provider requests with opt-in and sensitive-context minimization.
7. **Views** — Today, People, Activity, Follow-ups, Insights and Copilot, with advanced analysis routes preserved.

For Phase 2, **do not rewrite the entire 14k-line application in a single patch**. Start with one low-risk UI component, confirm parity and tests, then move another. A future Vite/esbuild modular pipeline is an option, not a Stage 1 decision or a reason to discontinue single-file support immediately.

### D. Risk register and mitigations

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Loss of historical records during schema refactor | Critical | Full-backup fixtures, explicit migrations, restore-after-upgrade test and recovery plan |
| Breaking existing advanced intelligence routes | High | Preserve 34 view-handler contracts and add route-level behavioral tests before moving links |
| Different code paths for bundled source and build output | High | Deterministic build, committed artifact parity and clearly identified source of truth per module |
| Secrets or personal data leaking into backups or logs | Critical | Retain sanitizer and SecretStore tests; independently inspect every new import or AI feature |
| Local mode unexpectedly using network | High | Continue zero-network browser test; explicit remote consent |
| Users losing history when browser/site origin changes | High | Explain origin-scoped IndexedDB, verify export/restore across origins before deployment changes |
| Complex UI with too many top-level destinations | High (UX) | Simplify default sidebar while retaining advanced route availability |
| False certainty in behavioral/relationship claims | High | Evidence attribution, uncertainty labels, no hidden-personality diagnosis |
| Regressions from large single-file editing | High | Incremental modularization, feature tests, visual review, minimal PRs |
| Only testing source checks rather than real behavior | High | CI Chrome acceptance, manual exploratory pass, failure screenshots or console logs |

## Verification procedure

From a Node 20+ environment and a clean checkout:

```bash
npm run build
npm test
npm run verify
npm run test:browser
npm run test:acceptance
npm run test:features
# equivalent full pipeline:
npm run check
```

Chrome or Chromium is required for browser/acceptance commands. The first command should make no change to the committed `index.html` on a clean main/PR baseline. If it does, investigate instead of committing a silently different artifact.

A passing static compatibility test is only one layer. It does not prove actual browser appearance, real data migration from every historical release, a third-party AI provider connection, or accessibility compliance.

## Hard Stage 1 exit criteria

- [x] Confirm actual repository and pinned baseline SHA.
- [x] Inventory source architecture and current public feature routes.
- [x] Inventory all 33 IndexedDB stores and data/export version boundaries.
- [x] Identify security and backward-compatibility requirements.
- [x] Define a staged modularization architecture and risk register.
- [x] Add automated, non-mutating regression guards to an isolated branch.
- [ ] Let GitHub Actions execute the PR test pipeline successfully.
- [ ] Resolve any PR CI failures and get the branch ready for review.
- [ ] Merge only after verification and approval; avoid an unreviewed direct-to-main deployment.

## Deliverables and next-stage handoff

**Stage 1 deliverables:** this audit/implementation brief and the baseline compatibility test. Both are additive and should leave the production HTML, database schema, stored user data, and live GitHub Pages application unchanged.

**Stage 2 input:** documented six-area navigation concept, design tokens and component architecture. Stage 2 can begin after the baseline tests pass. It must maintain access to the 34 existing routes (possibly under an Advanced hub), preserve the local-first privacy model, pass browser acceptance, and demonstrate desktop/mobile behavior.

**Not in Stage 1:** Supabase, cloud synchronization, a fully independent language model, external contact scraping, user-account changes, mobile app packaging, redesign of the entire interface, schema migrations, or production deployment. These require dedicated stages and explicit threat models and tests.
