# Persona AI v4 — Stage 2 Workspace Delivery

**Branch / review:** PR #11, upgrade/v4-stage2-workspace-and-data-integrity.
**Approach:** progressive enhancement, not a rewrite or data migration.

## Workspace information architecture

| New primary destination | Backed by |
| --- | --- |
| Today | Existing dashboard / daily briefing |
| People | Existing people profiles |
| Activity | Existing interactions timeline |
| Follow-ups | Dedicated UI over the existing followUps IndexedDB store |
| Insights | Existing evidence-grounded patterns |
| Copilot | Existing local-first Copilot |

Every historical route retains its original DOM button, data-view identifier, accessible label, render handler and action ID. The **All tools** toggle reveals all 34 historical desktop navigation destinations, including Open Loops, Decision Lab, analytics, reporting, backup settings and privacy. Advanced visibility is a non-sensitive localStorage preference (persona.ui.v4.allToolsExpanded).

The new Follow-ups route is additive (followups), not a rename/removal of the historical openloops destination. It displays scoped pending follow-ups ordered by due date, overdue/due-now/completed counts, and existing completeFollowUp, snoozeFollowUp and viewPerson commands. All content is HTML-escaped. The route creates no new IndexedDB stores.

At up to 720px viewport, a dedicated six-item bottom bar exposes the same six destinations directly. The existing floating Log button remains available. The hamburger menu still opens the full sidebar and All tools for advanced modules.

## Rendering and source architecture

- src/ui/workspace.mjs: initialization, active and accessibility state, Follow-ups rendering; no external network or dependency.
- src/ui/workspace.css: responsive focus styles, theme-variable-aware cards/navigation, reduced motion, mobile bottom bar.
- scripts/build.mjs: deterministically injects the above two files into index.html, keeping the offline single-file distribution and preserving original bundled section markers and the v3.1.1 application version.
- index.html: committed exactly as produced by npm run build; CI fails if the file differs.

## Regression and safety gates

- Stage 1 frozen contracts still require 33 stores, 34 historical routes and 112 dispatched actions.
- tests/v4-workspace.test.mjs validates six destinations, accessibility markers, responsive CSS, correct Follow-ups source data and escaping.
- tests/data-safety.test.mjs verifies deletion of historic audit entries that refer to a deleted person's ID without personId, while retaining unrelated audit entries.
- scripts/full-browser-acceptance.mjs covers desktop targets, All tools expansion, persistent Follow-ups completion, mobile breakpoint/navigation, historical routes, real backup round-trips, and mock AI provider isolation.
- CI runs build, unit/security regression, output verification, file/HTTP Chrome smoke, full Chrome acceptance and major feature workflows.

## Release boundaries

This deliverable is a Stage 2 navigation, information architecture and visual foundation, not proof that the complete Persona AI 4.0 ten-prompt roadmap is finished. Native Safari/iOS/Android browsers, screen readers, visual review and manual keyboard-only flows still need real-device testing. Do not call these verified when only headless Chrome and source-based tests were run.

The deletion cascade handles direct personId indexes and audit entries referencing the person primary ID (store people, recordId). Other indirect references without validated ownership are not automatically destroyed, to avoid accidental deletion of shared records. A data-erasure guarantee requires additional auditing of schema-specific links.

No changes have been made to main or production by this PR. Review and merge only after successful CI. The existing certified production workflow deploys merged changes.
