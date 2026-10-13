# Persona AI 4.0 — Stage 1 architecture and compatibility audit

**Audit date:** 2026-10-13 · **Source:** ZubaerAhmed13/Persona-AI, main at Stage 1 branch creation · **Baseline:** v3.1.1 · **Stage:** protective changes only.

**Verification vocabulary:** **Code-confirmed** means directly inspected in committed source; **test-present** means a repository test exists but this audit does not assert its current execution result; **browser-verified** only after a named run succeeds; **unverified** means behavior has not been independently reproduced. A static contract is not proof that every UI flow works.

## 1. Executive summary and scope

Persona AI v3.1.1 is a large, single-file, local-first relationship intelligence workstation. The production asset is a self-contained HTML document with inline CSS/JavaScript. It contains 34 main navigation destinations, 33 IndexedDB object stores, a locally computed analytics/decision layer, a deterministic question-answering Copilot, and optional external OpenAI-compatible model integration. Its v3.1.1 maintenance baseline adds a small hardening source module and deterministic patch/build tooling instead of converting the entire app to a framework.

**Stage 1 delivers** a frozen baseline contract, non-mutating static/fixture regression tests, an architecture and risk inventory, and a staged migration strategy. There are **no intended changes** to app UI, application HTML, data schema, record formats, storage keys, dependencies, runtime network calls or production deployment. Existing customer data is not accessed by the tests. Only a branch PR may introduce Stage 1 audit artifacts.

**Explicit limitations:** Existing browser acceptance programs do not establish all supported browsers or accessibility compliance, and test existence does not establish current passing status. A browser/user acceptance run is needed for end-to-end confirmation; a provider-specific live external-AI test is out of scope.

## 2. Source of truth and architecture inventory

| Boundary | Source / confirmed coupling |
| --- | --- |
| Runtime deliverable | `index.html` is a self-contained bundled HTML/CSS/JS artifact; the app can be opened via local file or HTTP hosting |
| Hardening source | `src/hardening/runtime.mjs` governs secret sanitization, session key storage, backup payloads, URL validation, and optional external AI request transport |
| Build pipeline | `scripts/build.mjs` + `scripts/fix-functional-tags.mjs` + `scripts/enforce-hardening-policy.mjs`; `scripts/verify.mjs` checks compiled script and production invariants |
| UI shell | Inline `views.js` and `app.js` sections; desktop sidebar, mobile nav, quick add, modal root, notification UI, palette/shortcuts |
| View dispatch | `render()` maps view IDs to renderer functions; `navigate2()`, `setView()`, `bindView()` and `wire()` coordinate rendering/bindings |
| State | In-bundle `state.js` provides the shared state object, subscriptions, settings updates, loaded per-store arrays and undo/redo support |
| Persistence | In-bundle `storage.js`; IndexedDB for records; localStorage for settings, UI/meta/report data; sessionStorage/in-memory fallback for API key |
| Analytics | In-bundle `analytics.js`, `intelligence.js`, `copilot.js` with direct access to state/records; heuristics, aggregate evidence scores, Wilson/Bayesian-style summary helpers, decisions, playbooks and signals |
| AI | Local rule-based `copilotAnswer()` and evidence packet `copilotEvidencePacket()`; optional `runCopilotPipeline()` + `openAICompatibleChat()` for external-model processing |
| Capture/search | `parseCapture()` / `captureToInteraction()`, UI quick/universal capture, `searchAll()` / `parseNaturalSearch()` |
| Export, privacy | `exportJSON()`, `encryptBackupJSON()`, `decryptBackupJSON()`, `safeImport()`, reporting/export and privacy views |
| Background work | In-page Blob Worker (`initWorker()`) with main-thread fallback; in-app reminders/notifications, not a guaranteed background push service |
| CI/deployment | `.github/workflows/hardening.yml` checks build/unit/browser acceptance on PR; main-branch certification is prerequisite for publishing on the deployment-only gh-pages branch |

The bundled module section names found in the artifact are: `utils.js`, `storage.js`, `analytics.js`, `icons.js`, `ai.js`, `copilot.js`, `intelligence.js`, `state.js`, `charts.js`, `ui.js`, `reports.js`, `export.js`, `validation.js`, `capture.js`, `automation.js`, `guidance.js`, `demo.js`, `worker.js`, `views.js`, `app.js`. These are emitted into one closure, **not** 20 separately maintained source modules; decomposing them must account for their global state, initialization order, DOM event delegation, and rendering dependencies.

### Data and UI dependency hotspots

1. View renderers read central state directly and create HTML via string templates. Event actions enter `handleAction()` (112 historical cases). Removing a route or changing an action ID can leave controls orphaned.
2. IndexedDB repositories and in-memory `state.data` arrays are coupled through load/insert/remove paths. Replacing persistence must synchronize view subscriptions, undo history, audit records, and import/reset behavior.
3. Person data is joined using `personId` rather than enforced foreign keys. Three additional links — `playbookId`, `signalId`, `decisionId` — appear in historical fixture examples.
4. Local and remote Copilot code share evidence construction but have different guarantees; remote model output undergoes structure/evidence validation and needs an explicitly configured endpoint.
5. Build scripts patch code by matching text patterns in the generated bundle. Updating source snippets or formatters can cause patch failures even when app semantics are unchanged.

## 3. Complete primary route/view inventory

All 34 listed route IDs have **code-confirmed navigation controls and render dispatch keys**. This verifies reachability by source wiring, not successful use of each form. The pre-existing browser acceptance script contains a route-navigation test, **test-present, execution not yet independently verified**.

| Route ID | Existing label | Menu | Status / evidence |
| --- | --- | --- | --- |
| `dashboard` | Today | Daily | Render handler present; behavior requires QA |
| `copilot` | Copilot | Daily | Render handler present; behavior requires QA |
| `openloops` | Open Loops | Daily | Render handler present; behavior requires QA |
| `decisions` | Decisions | Daily | Render handler present; behavior requires QA |
| `people` | People | Daily | Render handler present; behavior requires QA |
| `memory` | Memory | Daily | Render handler present; behavior requires QA |
| `commitments` | Commitments | Daily | Render handler present; behavior requires QA |
| `judgment` | My Judgment | Daily | Render handler present; behavior requires QA |
| `weekly` | Weekly Review | Daily | Render handler present; behavior requires QA |
| `monthly` | Monthly Review | Daily | Render handler present; behavior requires QA |
| `playbook` | Playbook | Intelligence | Render handler present; behavior requires QA |
| `situations` | Situations | Intelligence | Render handler present; behavior requires QA |
| `signals` | Signals | Intelligence | Render handler present; behavior requires QA |
| `decisionlab` | Decision Lab | Intelligence | Render handler present; behavior requires QA |
| `experiments` | Experiments | Intelligence | Render handler present; behavior requires QA |
| `interactions` | Interactions | Analysis | Render handler present; behavior requires QA |
| `journal` | Journal | Analysis | Render handler present; behavior requires QA |
| `patterns` | Patterns | Analysis | Render handler present; behavior requires QA |
| `reciprocity` | Reciprocity | Analysis | Render handler present; behavior requires QA |
| `reliability` | Reliability | Analysis | Render handler present; behavior requires QA |
| `communication` | Communication | Analysis | Render handler present; behavior requires QA |
| `initiative` | Initiative | Analysis | Render handler present; behavior requires QA |
| `boundaries` | Boundaries | Analysis | Render handler present; behavior requires QA |
| `conflict` | Conflict | Analysis | Render handler present; behavior requires QA |
| `support` | Support | Analysis | Render handler present; behavior requires QA |
| `context` | Context | Analysis | Render handler present; behavior requires QA |
| `preferences` | Preferences | Analysis | Render handler present; behavior requires QA |
| `predictions` | Predictions | Analysis | Render handler present; behavior requires QA |
| `relationships` | Relationships | System | Render handler present; behavior requires QA |
| `reports` | Reports | System | Render handler present; behavior requires QA |
| `data` | Data | System | Render handler present; behavior requires QA |
| `settings` | Settings | System | Render handler present; behavior requires QA |
| `privacy` | Privacy | System | Render handler present; behavior requires QA |
| `help` | Help | System | Render handler present; behavior requires QA |

**Additional UI workflows:** Search/command palette, dashboard filters, global capture, settings and AI permissions/preview, data backup and restore, user menu and lock, onboarding, confirmation dialogs, audit log, help/contextual help, report generation, quick actions and notifications exist in the source outside these 34 view IDs. The dispatcher contract records the **112 distinct actions**. Forms include person, interaction, observation, favor, commitment, prediction and outcome, preference, boundary, conflict, support, statement, memory, decision, follow-up, self-reflection, open loop, lesson, relationship goal, experiment, surprise and change-of-mind. Their handlers are visible in `index.html`; each needs form-by-form browser validation before any UI swap.

### Feature state classification

| Product area | Status | Evidence and limitation |
| --- | --- | --- |
| People, interactions, observations, records, editing, global search | Code-confirmed; tests present | Form functions, central dispatcher and existing workflow/browser scripts; individual validation and search combinations not exhaustively replayed |
| Memory, commitments, predictions, follow-ups, reviews | Code-confirmed; tests present | Dedicated renderers/actions; existing feature workflow acceptance scripts |
| Playbook, signals, situation intelligence, decision lab, experiments, goals | Code-confirmed; tests present | Renderers and stores present; derived indicator correctness remains dependent on real datasets |
| Local analytics, deterministic Copilot | Code-confirmed; tests present | `copilotAnswer()`, local pipeline, engine versions and existing offline assertions. Not a trained independent LLM |
| External AI | Partially verified / provider dependent | Transport, permissions UI, session credential handling and mocked tests exist; arbitrary provider authentication/CORS/output not independently verified |
| Backup/export/import | Code-confirmed; tests present; atomicity limitation | JSON, encrypted and safety paths exist. Failure midway through import may leave partial restored state; see risks |
| Person deletion | **Code-confirmed defect** | `deletePerson()` filters `people` by `personId === id`, but person records use `id` as key; person record is not explicitly removed |
| Navigation overlap / repeated actions | Overlap, not proven duplication | Open Loops, Commitments and Follow-ups have related action concepts. Intentional modules must remain available pending UX review |
| Copilot suggested questions | Minor duplicate | The prompt `What am I missing?` occurs twice in the source suggestions |
| Mobile/accessibility/cross-browser behavior | Unverified in full | Mobile nav and ARIA attributes exist; no evidence of full WCAG or Firefox/Safari certification |

### Complete action inventory — baseline dispatcher

Every ID below is preserved in `tests/contracts/v3.1.1.contract.json`; future additions are permitted, but deletions require an approved compatibility migration.

- **Dispatcher IDs 1–30:** `addPerson`, `editPerson`, `deletePerson`, `viewPerson`, `addInteraction`, `editInteraction`, `deleteInteraction`, `addObservation`, `deleteObservation`, `addFavor`, `deleteFavor`, `addCommitment`, `deleteCommitment`, `addPrediction`, `deletePrediction`, `outcomePrediction`, `addPreference`, `deletePreference`, `addBoundary`, `deleteBoundary`, `addConflict`, `deleteConflict`, `addSupport`, `deleteSupport`, `addStatement`, `deleteStatement`, `quickCapture`, `universalCapture`, `simulate`, `showMoreInteractions`
- **Dispatcher IDs 31–60:** `addMemory`, `deleteMemory`, `completeMemory`, `confirmMemory`, `archiveMemory`, `addDecision`, `deleteDecision`, `decisionOutcome`, `decisionBrief`, `personBrief360`, `healthReview`, `healthRepair`, `healthIgnore`, `addFollowUp`, `completeFollowUp`, `snoozeFollowUp`, `addSelfReflection`, `runWeeklyReview`, `runMonthlyReview`, `addSurprise`, `deleteSurprise`, `addChangeOfMind`, `deleteChangeOfMind`, `aiPreview`, `viewAuditLog`, `openHelp`, `openActionHelp`, `evidenceExplore`, `encryptedBackup`, `restoreEncrypted`
- **Dispatcher IDs 61–90:** `openAIPermissions`, `buildReport`, `buildReportMd`, `createObsReminder`, `reachOut`, `setLock`, `lockApp`, `unlockApp`, `setImportance`, `completeCommitment`, `lateCommitment`, `cancelCommitment`, `unknownCommitment`, `findPatterns`, `challenge`, `challengeText`, `blind`, `forecast`, `generateReport`, `exportReport`, `aiQuestion`, `answerQuestion`, `compare`, `evidence`, `nextObservations`, `loadDemo`, `backup`, `strategy`, `situationCompare`, `decisionLab`
- **Dispatcher IDs 91–112:** `addExperiment`, `experimentOutcome`, `deleteExperiment`, `addRelationshipGoal`, `deleteRelationshipGoal`, `askCopilot`, `askCopilotQuick`, `openCopilotWorkspace`, `addOpenLoop`, `closeOpenLoop`, `debrief`, `prepare`, `expectation`, `recordLesson`, `resolveExpectation`, `eveningDebrief`, `copilotQuick`, `saveJson`, `loadJson`, `resetAll`, `printReport`, `exportCSV`

## 4. Data model and backup compatibility specification

**Historical identity:** `DB_NAME = persona-ai`; IndexedDB open version **5**; `DATA_VERSION = 2`; record `SCHEMA_VERSION = 7`; app version **3.1.1**; analytics **3.1**; AI engine **2.1**; backup export format **3.1**. These are distinct version tracks; do not infer IndexedDB database version from the record schema version.

All 33 stores are created with key path `id` and nonunique `personId` and `date` indexes via `ensureStore()`. Indexes can have no entry when the property is absent. There are no enforced IndexedDB foreign-key constraints.

| Historical store | Representative linked identifiers | Representative fields (fixture) |
| --- | --- | --- |
| `people` | No reference in fixture | `name`, `relationshipType`, `notes` |
| `interactions` | `personId` | `type`, `context`, `initiator` |
| `observations` | `personId` | `category`, `observedBehavior`, `evidenceType` |
| `favors` | `personId` | `type`, `whoGave`, `whoReceived` |
| `commitments` | `personId` | `description`, `dueDate`, `completed` |
| `predictions` | `personId` | `prediction`, `confidence`, `outcome` |
| `preferences` | `personId` | `category`, `value` |
| `boundaryEvents` | `personId` | `boundary`, `response`, `outcome` |
| `conflictEvents` | `personId` | `trigger`, `response`, `resolution` |
| `supportEvents` | `personId` | `type`, `direction`, `description` |
| `statements` | `personId` | `statement`, `outcome` |
| `memories` | `personId` | `text`, `category` |
| `decisions` | `personId` | `question`, `situation`, `confidence` |
| `weeklyReviews` | No reference in fixture | `weekStart`, `summary` |
| `selfReflections` | No reference in fixture | `text` |
| `followUps` | `personId` | `text`, `dueDate`, `completed` |
| `reminders` | `personId` | `text`, `dueDate`, `completed` |
| `surprises` | `personId` | `expected`, `actual`, `note` |
| `changeOfMinds` | `personId` | `before`, `after`, `evidence` |
| `monthlyReviews` | `personId` | `month`, `summary` |
| `auditLog` | No reference in fixture | `store`, `action`, `at` |
| `openLoops` | `personId` | `title`, `status`, `dueDate` |
| `expectations` | `personId` | `title`, `expected`, `status` |
| `debriefs` | `personId` | `title`, `outcome`, `notes` |
| `lessons` | `personId` | `lesson` |
| `playbooks` | `personId` | `title`, `strategy`, `status` |
| `playbookHistory` | `personId`, `playbookId` | `playbookId`, `change` |
| `signals` | `personId` | `type`, `label`, `direction` |
| `signalHistory` | `personId`, `signalId` | `signalId`, `confidence`, `evidenceCount` |
| `situations` | `personId` | `title`, `context`, `status` |
| `experiments` | `personId` | `hypothesis`, `action`, `status` |
| `decisionOptions` | `personId`, `decisionId` | `decisionId`, `label`, `pros` |
| `relationshipGoals` | `personId` | `goal`, `status` |

The fixture at `tests/fixtures/v3.1-full-backup.json` contains synthetic records across every store, including the primary and cross-record reference IDs, top-level `app` metadata and `appVersion` (older fixture form). The canonical current backup builder instead emits `version`, `schemaVersion`, `exportFormatVersion`, `exportedAt`, `settings` and `data`. Import schema detection currently checks the top-level `app` identity but does not rigorously version-negotiate every record or reject all invalid data (see P0 import risk).

**Record contracts:** Preserve `id`, `personId`, relevant timestamps and schema fields, all additional custom fields, and the special linked IDs listed above. Never auto-renumber records. Existing records may be older or missing optional fields: the fixture is representative, not a complete schema definition for all years.

**Settings:** The persistent key is `persona.settings.v1`; baseline default names: `theme`, `aiEnabled`, `aiProvider`, `aiEndpoint`, `aiModel`, `demoMode`, `userName`, `onboardingDone`, `analyticsMode`, `quickCapture`, `briefingMode`, `verbosity`, `backupReminder`, `notifCategories`. Additional user settings may exist and must be retained. Meta and audit-adjacent values include `persona.meta.v1`, `persona.migration.lastReport`, `persona.feedback.v1` and `persona.nav.*`. External API key is *not* a persistent setting: `persona.secret.aiApiKey.session` in sessionStorage, memory-only fallback.

**Backup formats:** Unencrypted `persona-ai-backup.json` is a structured JSON payload. Encrypted wrapper uses `format: persona-encrypted-v1` with byte arrays `salt`, `iv` and `ciphertext`; encryption is PBKDF2-SHA256 (100,000 iterations) + AES-GCM. The pre-import safety backup is normal JSON with `reason: pre-import-safety` and no copied API credential. The source contains a decryption and restore UI. Existing full browser acceptance code tests export/reset/restore equality and encrypted roundtrip; Stage 1 static tests independently preserve the format markers but are not a substitute for a successful browser run.

**Historical migration history:** `migrateV1ToV2`, `migrateV2ToV3`, `migrateV3ToV4`, `migrateV4ToV5`, `migrateV5ToV6` and `migrateV6ToV7` remain in the bundle. The last performs a schemaVersion backfill and the finalize path writes a migration report/audit entry. The new Stage 1 branch does **not** run a schema upgrade or modify these routines.

## 5. Security/privacy and AI boundary

- **Local-first:** IndexedDB holds local records, localStorage holds settings/meta. No new server, CDN, runtime package or analytics telemetry is introduced in Stage 1. Source uses an inline Blob Worker with local fallback; existing Chrome smoke programs test both local file and HTTP modes.
- **Credential handling:** v3.1.1 introduced `SecretStore`, deep secret-field stripping, session key storage, legacy key migration and URL scheme/userinfo/query-param validation. The API key is not a safely encrypted local vault: scripts executing in this page's origin can potentially access sessionStorage. Preventing XSS is therefore critical.
- **Optional remote AI:** Only use an explicitly configured provider; external request context can include selected personal records. The UI offers permissions, preview, anonymization and redaction, but their effectiveness across *all* AI entry points needs dedicated end-to-end verification. A user-configured endpoint can independently have its own privacy terms.
- **Evidence limitations:** Local rules, aggregation and heuristics are deterministic analytical functions. They are not a self-trained foundation model. The external pipeline requests structured answers with evidence IDs, validates the response, and falls back to a safe blocked response in some failure cases. Confidence must be derived from evidence, not from unsupported personality or medical diagnosis.
- **Deletion:** The person cascade bug below makes an unqualified complete deletion/privacy assurance inappropriate. Browser storage clearing and external-provider retention are also outside Persona's unilateral guarantees.
- **Compliance:** This review does not establish GDPR certification, penetration-test completion, or security of each optional provider.

## 6. Technical and product risks (severity / mitigation)

| Risk | Status | Consequence | Planned mitigation and test |
| --- | --- | --- | --- |
| **P0: Non-atomic backup restore** | Code-confirmed | `safeImport()` calls `db.clear(store)` and individual `db.put()` sequentially across stores; interruption may leave partial data | Make a validated, recoverable transactional or shadow-copy import in a separate bugfix stage; test quota failures, invalid payloads, interruptions and rollback |
| **P0: Weak import compatibility gate** | Code-confirmed | `detectSchema()` accepts any object with `app === PERSONA AI`; validation errors are displayed but the import action remains available | Fail closed for invalid data, unknown stores and incompatible schema; retain explicit recovery for historical formats and test malformed/oversized inputs |
| **P0: Person deletion incomplete** | Code-confirmed | `deletePerson()` does not explicitly remove the `people` record by primary ID | Add a failing browser regression before fix; remove person by ID, cascade all linked records with transaction, retain explicit user confirmation and verify no orphan records |
| **P1: Legacy migration transaction lifetime** | Code-confirmed design hazard; failure unverified | `migrateV6ToV7()` retains a readwrite transaction across awaited reads; IndexedDB transaction inactivation can cause partial backfill | Test migrations from fresh copies of old fixtures in real Chrome, repair transaction boundaries and ensure idempotent resume/rollback before any new schema |
| **P1: HTML templating and XSS** | Needs targeted review | Unescaped interpolation can compromise session secrets and local records | Audit every user-controlled interpolation and URL sink, use safe DOM construction/escaping; fuzz input/display/export |
| **P1: Destructive resets and cascade actions** | Code-confirmed UI confirmation; recovery unverified | Confirmation alone does not guarantee recoverable data | Require explicit downloadable backup before destructive schema transitions; manual recovery exercise |
| **P1: External provider privacy** | Partially verified | Permissions/sanitization errors can send unintended record types | Trace and test every remote-AI trigger with mocked network capture; require preflight payload visibility, domain allow-list and visible consent |
| **P2: Bundle-patcher brittleness** | Code-confirmed | String-based patching may silently drift or block a build | Keep static sentinels, exact blob gate and browser parity tests; extract domains incrementally behind adapters |
| **P2: Browser/device coverage** | Unverified outside scripted Chrome | Mobile keyboard, Safari/file origin, accessibility or touch may regress | Safari/Firefox/manual mobile screen-reader matrix; WCAG keyboard/focus/contrast audits |
| **P2: Scattered business logic** | Code-confirmed coupling | Refactoring navigation may change behavior unexpectedly | Extract pure selectors and repository wrappers behind stable adapters; no rewrite in one commit |

These findings are *not* repaired by adding static regression tests alone. P0 fixes require isolated follow-up changes, executable failure reproductions and verified data-preserving restoration. Production remains unchanged in this Stage 1 PR.

## 7. Incremental modularization and migration strategy

**Do not run structural data migrations in Stage 1.** For all subsequent schema proposals, require: rationale → compatibility contract diff → signed-off fixture matrix → user-initiated verified pre-migration backup → versioned/idempotent migrator → record/relationship comparison → interruption recovery → old-backup import check → guarded rollout/rollback instructions. Never upgrade a user's live DB merely to render a new sidebar.

1. **Shell/compatibility adapter:** Introduce opt-in application shell and route adapter without changing 34 original IDs. Preserve old renderers as fallbacks; contract-test all navigation IDs.
2. **Design system:** Extract tokens, typography, spacing, states, accessible dialog/list/table primitives in small feature slices. Contrast, keyboard/focus and mobile parity become gates.
3. **State/domain services:** Introduce read-only selectors and domain action facade; keep current `state.data`, emitter and persisted semantics until dual-path tests pass.
4. **IndexedDB repositories:** Wrap existing DB API without DB_VERSION changes; later create explicit versioned repositories with identity-preserving migration tests.
5. **People/activity:** Migrate profile/interaction/observation/favor/memory screens one at a time behind feature flags; compare create/edit/delete/search and person linking.
6. **Follow-ups/commitments:** Create a unified Today workflow surface but keep followUps, commitments, reminders and openLoops distinct underneath; no semantic merges before migration proof.
7. **Search/structured capture:** Preserve current natural-language keyword capture and global search; add structured suggestions and record-link preview without data mutation until confirmed.
8. **Insights:** Move analytics, reports, confidence, prediction and playbook/situation/signal modules to shared selectors with golden fixture outputs.
9. **Copilot:** Separate local rule-based deterministic capabilities from optional remote model transport; evidence receipts, citations, source/date, unknown state and permission gates remain visible.
10. **Privacy/export:** Harden validation, deletion, backup and interrupted-migration recovery before scaling features.
11. **Responsive/accessibility:** Progressive replacement with keyboard, touch, screen-reader, large-text and low-bandwidth acceptance.
12. **CI/deployment:** Branch PRs run unit, build, browser/feature and manual checklists; deploy only a certified reviewed commit after merge approval.

**Stage 2 visual information architecture:** Today / People / Activity / Follow-ups / Insights / Copilot. Keep all 34 historical destinations discoverable through contextual subnavigation and an Advanced workspace; no screen disappears. Use the new design system behind per-screen toggles and measure task completion instead of visual polish alone.

## 8. Testing matrix and evidence rules

| Gate | Existing / Stage 1 evidence | Must be confirmed before Stage 1 sign-off |
| --- | --- | --- |
| Store/route/action/version preservation | New `tests/v4-compatibility-contract.test.mjs` + frozen `tests/contracts/v3.1.1.contract.json` | Unit suite passes |
| Legacy full backup identities and links | Synthetic all-store fixture and new relationship assertions | Unit + browser full import passes |
| Existing security and import policy | `tests/security-hardening.test.mjs` and `tests/import-policy.test.mjs` | Unit suite passes |
| Deterministic self-contained production bundle | New Git blob SHA assertion, existing build/policy/verify scripts | Byte-identical build and script syntax checks pass |
| Direct-file and hosted Chrome | `scripts/browser-smoke.mjs` | Browser smoke run passes without uncaught errors or unintended requests |
| Plain/encrypted restore, mocked remote AI | `scripts/full-browser-acceptance.mjs` | Browser acceptance run passes and all IDs survive |
| CRUD/capture/follow-ups/relationship intelligence | `scripts/feature-workflow-acceptance.mjs` | Feature workflow acceptance run passes |
| Wider browser/mobile/accessibility, backup failure injection | Manual plan, not currently certified | Explicitly document as unverified, add tests in follow-up PRs |
| Production deploy protection | Existing separate main → gh-pages workflow | PR-only run; verify no production branch modified |

**Recommended execution:** run `npm run check` (includes build, security tests, verify, smoke, full acceptance, feature acceptance) on CI with Node >=20 and real Chrome. Inspect actual run IDs/results; never claim PASS from script existence. Additionally run manual clean-session and populated historical-backup exercises on Chrome, Firefox, Safari and mobile. Verify encrypted password failure, corrupted file, cancellation, quota full, offline start, keyboard-only navigation and locally configured external AI. Test with synthetic records only.

## 9. Acceptance criteria and handoff

Stage 1 sign-off requires: accurate inventory; frozen 33 stores and 34 routes; documented upgrade risk controls; committed and passing new tests; unchanged generated production bundle; passing existing build + full browser/feature acceptance; no production deployment; isolated PR reviewed. Anything not actually run remains unverified.

**Current recorded status in this document:** Branch and contract/test/audit code prepared; execution results, PR CI outcomes and manual cross-browser QA must be checked separately after PR creation. Critical risks above are explicitly tracked as open and are not automatically resolved by Stage 1 documentation.

**Stage 2 entry gate:** No design migration begins until the reviewer accepts this inventory and the regression baseline passes. The first Stage 2 PR should create a reversible design token + application shell proof, demonstrate parity on the 34 routes, and leave all storage and backup contracts unchanged.
