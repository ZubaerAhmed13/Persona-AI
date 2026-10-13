# Persona AI 4.0 — Stage 5: Smart Capture, Contact CSV, Search and Duplicate Safety

## Scope

Stage 5 upgrades local-first capture, people import, and global search without schema, API key, or server changes. This release is intentionally additive to the 34 historical routes, Stage 2 six-area workspace, Stage 3 Today selectors and Stage 4 people timeline. The existing JSON/encrypted restore paths are unchanged.

### Smart capture
- The legacy Universal Capture action opens a new review-first form.
- Natural-language suggestions are local and editable. Known people are matched with whole-token names/aliases. Ambiguous matches require user selection.
- The selected person, date, observed facts, event type, initiator and optional interpretation are inspected before saving. Edits to the original note invalidate the preview.
- Identical interaction/person/date combinations issue a warning and require a second explicit **Save anyway** click, without silently overwriting data.
- Quick Capture receives equivalent duplicate checking.
- The existing legacy parsing engine and capture workflows remain in the historical bundled source, with the Stage 5 action mapped to the reviewed experience.

### Duplicate person guard
The previous behavior warned that a same-name contact existed and then created another contact unconditionally. This stage requires an explicit confirmation to make a separate profile. Matching is case-insensitive, Unicode-normalized and includes aliases. It does not merge or delete historical profiles.

### Local contacts CSV import
- Visible from the People directory and Data Management header.
- Accepts CSV up to 1 MB and 500 contacts, with quoted cells/newlines and a required Name/Full Name column.
- Optional columns: alias, organization, relationship, notes, communication preferences, important dates.
- Previews every row; invalid and duplicate name/alias rows are disabled and skipped. Valid rows can be deselected.
- Requests a normal JSON backup download before adding records. Import itself runs in one IndexedDB read-write transaction covering people and auditLog.
- On conflict, aborts the entire transaction instead of silently overwriting existing records. Existing data never receives an automatic merge.
- Contacts and CSV contents remain on the local device; no remote service or AI model is called.

### Relevant global search
A local-only, ranked lexical selector searches existing people, interactions, observations, memories, commitments, decisions, follow-ups and predictions. This corrects a prior behavior in which ordinary unmatched text sometimes returned arbitrary records. Existing natural-language date/person scoping is preserved where supported.

## Architecture
- `src/domain/smart-capture.mjs`: pure string normalization, possible duplicates, CSV parsing/preview, ranked search.
- `src/ui/smart-capture.mjs`, `.css`: review-first forms, atomic import, escape-aware UI, responsive styling.
- `scripts/stage5-build.mjs`: idempotent final integration into `index.html`. The self-contained/offline delivery format is preserved.
- `tests/v4-smart-capture.test.mjs`: matching, duplicate safeguards, CSV, search and bundle assertions.
- `scripts/full-browser-acceptance.mjs`: real Chrome test for import preview/commit, stored-record search and human-approved smart capture.

## Release acceptance
Run `npm run check` (Node 20+ with Chrome/Chromium), then check a second `npm run build` is byte-identical. The GitHub hardening workflow must pass the full sequence of Node tests, direct-file/HTTP Chrome smoke, full UI/backup acceptance and major feature workflows. Require success of the main-branch postmerge certification and live Pages smoke before calling production deployed.

## Explicit boundaries
- This is not Gmail/Outlook/calendar synchronization, cloud contacts, vCard import, a trained LLM, cross-device sync, or an automatic CSV merge.
- CSV is a people-only additive importer, not replacement of the full data backup format.
- Existing usernames/identifiers and the 33-store schema are unchanged.
- Manual Safari/mobile screen-reader visual testing is still required beyond CI Chrome coverage.
