# Persona AI 4.0 — Stage 6: Follow-ups, Commitments, Reminders and Reviews

## User outcome

Make existing local reminders and recorded commitments more useful, predictable and easier to act on without implying automatic background notifications or changing the storage schema.

### Improvements

- **Follow-up work queue:** Overdue and due today are emphasized, with separate Upcoming, Snoozed, Unscheduled, Completed and Cancelled filters. The status counts are derived from actual saved records, not simulated metrics.
- **Safe postponement:** +3 and +7 day actions postpone from the later of the present local calendar day and a future due date. Snoozed future records are kept in the Snoozed filter and do not inflate immediate due counts. The original record ID remains stable.
- **Reschedule:** Explicit date-picker confirmation to change the due date of existing follow-ups and commitments. Legacy `dueDate` and modern `expectedCompletion` fields remain supported without rewriting historical records or creating a new store.
- **Reopen:** Completed or cancelled follow-ups can be restored as active without adding duplicate records.
- **Actionable review snapshot:** The Commitments, Weekly Review and Monthly Review screens display overdue, due today, next seven-day and undated task counts, plus contextual actions. Existing analytics and generated review workflows remain intact underneath.
- **Commitment compatibility fix:** The historical Commitments screen now recognizes older `dueDate` fields and `description` labels as well as `expectedCompletion`/`commitment`. Overdue logic uses local calendar days.
- **Reminders:** Upcoming memory reminders are surfaced in planning summaries, with the existing review/complete action available.

## Source architecture

- `src/domain/followup-planner.mjs` — pure date validation, task categorization and weekly planning selectors. Does not read storage, use the network or mutate data.
- `src/ui/followup-planner.mjs` and `.css` — accessible queue, review snapshot and explicit update workflows.
- `scripts/stage6-build.mjs` — deterministic integration into the existing offline `index.html`. Stage 1–5 modules, routes and historical bundle compatibility are preserved.
- `tests/v4-followup-planner.test.mjs` — source-based tests for local dates, legacy records, snooze/closed state, per-person filtering, escaping and data schema invariants.
- `scripts/full-browser-acceptance.mjs` — Chrome browser acceptance tests for actual snooze, reschedule, legacy dueDate commitments and weekly planning UI.

## Safety, accuracy and privacy

- Reminders are shown **when the app is open**; this release does **not** add background push notifications, calendar integrations, email monitoring or a backend scheduler.
- A missed scheduled date is not an assessment of the other person's reliability, intentions or character.
- User-provided labels and IDs are HTML-escaped before insertion into UI strings.
- Rescheduling changes only approved fields on the selected record, retaining its ID, people associations and existing backup compatibility.
- Dates are compared as valid YYYY-MM-DD calendar keys. Invalid or undated tasks are not treated as overdue.
- The existing 33 IndexedDB stores, record schema v7, IndexedDB version 5, offline operation and plain/encrypted backup formats remain unchanged.

## Completion gates

1. `npm run build` succeeds and re-running it is byte-identical.
2. `npm test`, `npm run verify`, `npm run test:browser`, `npm run test:acceptance`, and `npm run test:features` pass.
3. The browser test confirms that a snoozed item is absent from Due now, appears in Snoozed, and can be rescheduled with a persisted date.
4. An older commitment containing `description` plus `dueDate` appears in Commitment priorities, without a schema migration.
5. Historical routes, Stage 5 CSV/capture/search and full backup round-trip tests still pass.
6. Merge is allowed only after GitHub Actions certifies the PR; production deploy and live Pages smoke must independently succeed.

## Deferred to future work

- System notifications while the application is closed, background push, recurring server-side schedules and calendar sync require additional user-consented infrastructure and are **not implemented** by Stage 6.
- Manual Safari, assistive-technology and mobile-device evaluation remain necessary in addition to GitHub headless-Chrome CI.
