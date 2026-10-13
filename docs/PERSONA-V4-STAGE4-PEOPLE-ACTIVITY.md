# Persona AI 4.0 — Stage 4: People profiles and unified activity

## Goal and delivery

Stage 4 improves the usefulness of the existing People and Activity screens without modifying, replacing, or migrating any of the existing 33 IndexedDB stores. It is a progressive enhancement of the existing self-contained production application. The source of truth remains the current repository build, not a separate website.

### Person overview

Opening any existing person profile now displays an **At a glance** card *above* the original deep analytics: last recorded interaction date, outstanding follow-ups, outstanding commitments, saved memory count, and next dated follow-up. It offers safe, familiar **Follow-up** and **Edit profile** actions, backed by the existing action dispatcher and unchanged saved-record schemas.

The profile also has a **Recent activity with this person** timeline. The original profile's analytics, decisions, patterns, reports, context, notes, forms and advanced tools remain present and unchanged.

### Unified Activity

The existing Activity destination (\`interactions\`) now has a read-only chronological feed of:

- \`interactions\`: observed content separated from interpretations
- \`observations\`: recorded evidence
- \`memories\`: voluntarily recorded details
- \`commitments\`: creation date and due date displayed separately
- \`decisions\`: documented question/context
- \`followUps\`: creation date and due date displayed separately

It supports independent **person**, **record type**, and **search** filters with an incremental **Show more records** control (24 additional records per click; person profile initially shows 12). Records without a source timestamp are labeled **Date not recorded**, not assigned invented timestamps. Future due dates are never described as the date an interaction happened.

The legacy interaction list, filters, CSV export and create/edit/delete controls remain below the unified feed. No new data is generated and no existing actions are removed.

## Architecture changes

- \`src/domain/person-activity.mjs\`: pure read-only selectors for chronological record aggregation, filtering and person-level counts. Exports \`personaV4ActivityList\`, \`personaV4PersonSummary\`, and \`personaV4FilterActivity\`.
- \`src/ui/person-activity.mjs\`: escaped activity row rendering, person summary UI, timeline shell, DOM mounting, and bind-time search/filter/more handlers.
- \`src/ui/person-activity.css\`: responsive styling using existing theme variables and visible keyboard focus.
- \`scripts/build.mjs\`: deterministic integration of the new CSS/runtime into the existing self-contained \`index.html\`.
- \`index.html\`: the built artifact, with additive hooks in the existing render/bind cycle.
- \`tests/v4-person-activity.test.mjs\`: unit, XSS and bundle regression checks.
- \`scripts/full-browser-acceptance.mjs\`: real Chrome verification of the new People and Activity flows.

**No schema migration, new external dependency, account creation, cloud sync, background tracking or remote network request is introduced.** All timeline information is selected from records already stored in the local browser. Browsing the timeline is non-mutating. Legacy data IDs remain intact and unchanged.

## Security and privacy

All person names, imported record IDs, descriptions, date text and interpretations are escaped before interpolating into UI markup. New rendered links use the existing viewPerson dispatcher, without introducing executable event attributes. Personal observations remain distinguishable from human interpretations; no AI-inferred personality labels or automatic assessments are created.

The timeline is generated locally with no new endpoints, telemetry, provider keys, or implicit analysis requests.

## Acceptance checklist

1. `npm run build` is deterministic and leaves committed `index.html` unchanged on a second run.
2. `npm test` preserves Stage 1 historical route/action/data contracts and passes the new Stage 4 selectors, privacy, escaping and CSS markers.
3. `npm run verify` confirms the production bundle is valid.
4. `npm run test:browser` passes both local-file and hosted Chrome startup.
5. `npm run test:acceptance` validates real historic fixture ingestion, unified Activity filters, contextual person profile, all historical routes, JSON/encrypted backup and restore, and expected security protections.
6. `npm run test:features` preserves existing full-feature workflows.
7. The PR is reviewed and merged only after successful CI; the existing production workflow verifies deployment separately.

## Boundaries / later work

- This is a **read-only timeline and person overview**, not automatic contact syncing, calendar/email integration, a new LLM, or the complete Stage 4 redesign of every analytics subview.
- Dates are formatted as the stored ISO calendar portion, with no inferred timezone or generated event time.
- This provides source and headless-Chrome coverage; manual iOS/Safari, screen-reader and broad accessibility testing remain separate validation tasks.
- The existing advanced profile is intentionally still information-dense. Further tab-based organization should happen incrementally with feature parity tests.
