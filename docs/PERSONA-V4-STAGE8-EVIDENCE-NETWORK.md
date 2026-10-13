# Persona AI 4.0 — Stage 8: Relationship Network & Evidence-First Decision Lab

## Delivered user experience

Stage 8 adds an interactive, keyboard-accessible **recorded-contact network** to the existing Relationship Analytics screen, plus source-grounded evidence panels for Pattern Discovery and Decision Lab.

The network displays one central **You** node and one edge to each visible person that **the user has explicitly saved**. Edges are not inferred between other people. The edge width represents the count of interactions the user recorded, **not** trust, affinity, closeness, reliability, or relationship quality. An absent interaction means only that none is recorded, not that the relationship is weak.

## Relationship network

- Interactive SVG with accessible directory/list controls for selecting a contact.
- Local search by contact name, organization and stored relationship category.
- Detail pane with original record excerpts and one-click source inspection.
- Original IDs are retained; the evidence selector never reads another person's notes.
- Contact list is presented alphabetically. The first 24 matching contacts are shown; refine the filter to find more. The display limit is explicitly stated.
- The original static network remains available in a collapsible section for continuity.
- No new remote requests, social scraping, cross-contact graph inference or background tracking.

## Decision Lab and Pattern Discovery

- **Decision Lab:** preview saved records for the selected person and typed decision question without saving or changing the existing decision-analysis workflow. Relevance is simple local text overlap. High-impact, difficult-to-reverse choices trigger a caution to consider alternatives and independent checks; no fabricated recommendations.
- **Pattern Discovery:** supplemental evidence coverage banner identifies the displayed record count, dated sources in the last 90 days, undated items and uncertainty. These are descriptive counts, not personality judgments.
- **Source inspection:** record snippets come from the original local stores; interpretations are shown separately and clearly marked as interpretations, not facts. The displayed record label, date and person scope can be verified by the user.

## Technical architecture

- `src/domain/relationship-network.mjs`: pure selectors for contact hub, evidence, recency and decision context.
- `src/ui/relationship-network.mjs`: SVG rendering, accessible interaction, filtering, source modal, Decision Lab preview and Pattern Discovery evidence panel.
- `src/ui/relationship-network.css`: responsive styling and focus indications.
- `scripts/stage8-build.mjs`: deterministic integration into the hardened, self-contained `index.html`.
- `tests/v4-relationship-network.test.mjs`: no invented edges, source isolation, decision uncertainty, XSS, compatibility tests.
- `scripts/full-browser-acceptance.mjs`: real Chrome tests for contact selection, source inspection, filtered network, decision preview and non-mutating views.

**Data/compatibility:** no change to existing 33 IndexedDB stores, schema v7, IndexedDB version 5, original record IDs, encrypted/unencrypted backups, local offline mode, historical route destinations, or existing analyses.

## Known limits

- This is not a graph of verified friendships between contacts. Those relationships are unknown unless users record them, and this release deliberately does not infer them.
- Recent evidence and record counts describe **saved data**, not completeness, truthfulness, intentions or causation.
- Relevance matching is deterministic keyword overlap. It is not a trained AI model.
- The evidence preview is advisory only; it does not guarantee decision correctness.
- The diagram shows at most 24 people simultaneously for legibility, with a filter to explore the remainder.
- Full native Safari/assistive-technology QA and wider privacy/security checks are reserved for Stages 9 and 10.

## Release gate

Run `npm run check` including Node unit and safety tests, browser smoke, full product/backup/AI acceptance, and major feature-workflow acceptance. The production `index.html` must be generated deterministically and committed before the PR merges. Complete independent PR verification, main-branch certification and public GitHub Pages exact-artifact verification before calling it deployed.
