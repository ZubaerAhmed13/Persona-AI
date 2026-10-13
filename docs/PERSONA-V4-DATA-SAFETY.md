# Persona AI v4 safety fixes — restore and deletion runbook

**Scope:** PR #10, no IndexedDB schema upgrade and no new runtime dependencies.
**Baseline:** Persona AI 3.1.1, database persona-ai / IDB version 5 / record schema 7, 33 stores.

## Changes

### 1. Person deletion

The previous person-deletion routine iterated over every store filtering for personId and therefore did not remove the primary person record from people (which uses id). The new routine uses a single readwrite IndexedDB transaction across all historical stores. It deletes people[id] and scans each other store's personId index, deleting matching records, including linked audit entries. All requests share one commit/abort boundary. It does not delete other people's unrelated records.

The UI retains an explicit destructive-action confirmation, reloads data from IndexedDB after the successful commit, and displays an error if the transaction aborts. Deletion is irreversible without a backup. For records that contain **only an indirect ID reference** and no personId, the automatic cascade cannot prove ownership; those exceptional historical records require manual review. Do not claim an unrestricted right-to-erasure compliance guarantee from this change alone.

### 2. Safe plaintext and encrypted restore

Both import entry points run validatePersonaBackup before any live storage mutation. The browser initiates download of a canonical, credential-free safety backup of the existing state, then replaces all included stores within *one* IndexedDB readwrite transaction. If any request fails or the transaction aborts, IndexedDB rolls back the entire replacement. Existing unmentioned stores remain unchanged.

Settings and API-key session state change only *after* the record transaction completes. **Boundary:** localStorage is not part of IndexedDB's transaction; an interrupted process between committing records and applying settings could leave old settings with new records. The downloaded safety backup is the recovery mechanism, not a database-wide two-phase commit. A browser can block downloads, so export and verify a manual backup before important restores. Do not present the download click as confirmed disk persistence.

Encrypted export remains PBKDF2-SHA256 (100,000 iterations) + AES-GCM, wrapper format persona-encrypted-v1. The existing JSON and historical v3.1 fixture formats are retained; no passwords/API keys are exported.

### 3. Compatibility validation

The validator requires application identity, data-store object, recognized store names and arrays, valid unique IDs per store, supported schema/export versions, person name, and valid optional timestamps. It verifies known relational links (personId, playbookId, signalId, decisionId) against the *effective resulting dataset*, considering both imported and retained stores. It accepts older backup metadata omissions and partial backups when the retained references resolve; it does not silently discard unknown stores or import unsupported future record schemas.

**Important:** This is structural and relational validation, not a proof that all free-text content is true or benign. UI display escaping and input-size handling remain separate security concerns.

## Recovery instructions

1. Before a restore or destructive deletion, use **Data → Export backup**. Verify that the JSON file is present and starts with app "PERSONA AI", or save an encrypted backup and retain its password privately.
2. For restore, select the file and inspect the preview. If rejected, leave the current data unchanged and correct/use another historical backup; do not manually strip unknown stores and retry without understanding the implications.
3. If restore fails, do not reset data. Reload Persona AI, check the current People, Activity, Follow-ups, and Data screens, and compare counts. IndexedDB transaction failures do not partially commit record-store replacements.
4. If a browser/tab crashed **after** a committed restore but before settings were applied, use Data → Import Backup with the pre-import safety file (or a verified manual backup). Reconfigure optional external API credentials for the current session.
5. To recover from a deliberate deletion, import a backup created *before* the deletion. A deletion confirmation does not create an automatic undo copy.

## Automated verification

- tests/data-safety.test.mjs covers historical fixture acceptance, legacy metadata, partial backups, invalid formats, duplicates, missing IDs, broken relationships, atomic transaction success/abort, cascade success/failure.
- tests/import-policy.test.mjs checks wiring and correct ordering of backup, transaction, session secret and settings changes.
- scripts/full-browser-acceptance.mjs exercises real Chrome: import/export, plaintext/encrypted round trip, invalid-file rejection, deletion of a fixture person, foreign record exclusion, persistence after reload.
- The existing v4 compatibility contract, hardening unit suite, HTTP/file browser smoke, and feature workflow acceptance continue to run from the PR CI.

## Manual checks still required before production release

Test Firefox and Safari, local-file vs hosted origins, long-running and low-disk-space restorations, cancelled download permissions, encrypted backup with wrong password, migration from *real anonymized* older user backups, a hard tab shutdown during transaction, and mobile touch/keyboard navigation. Never run destructive tests on irreplaceable real user data. Current CI cannot assert a backup was saved to disk or certify regulatory compliance.

**Deployment:** Review and merge PR only after full CI passes; merging main triggers the existing separate certified deployment pipeline. No direct gh-pages or production modification is part of this fix.
