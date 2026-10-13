import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { repairPersonaLegacySchemas } from "../src/safety/migration.mjs";
import { personaV4IsFollowUpDue } from "../src/ui/workspace.mjs";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

// This in-memory request/transaction fixture exercises cursor behavior and
// commit/rollback boundaries without assuming a browser or third-party package.
function legacyDb(seed, options = {}) {
  let committed = Object.fromEntries(Object.entries(seed).map(([k, rows]) => [k, structuredClone(rows)]));
  const states = [];
  return {
    states, snapshot: () => structuredClone(committed),
    transaction(name, mode) {
      assert.equal(mode, "readwrite");
      states.push(name);
      let settled = false, aborted = false;
      const staged = structuredClone(committed[name]);
      const tx = {
        oncomplete: null, onabort: null, error: null,
        abort() { aborted = true; queueMicrotask(() => this.onabort?.()); },
        objectStore(s) {
          assert.equal(s, name);
          return {
            openCursor() {
              let index = 0;
              const req = { result: null, onsuccess: null };
              const forward = () => queueMicrotask(() => {
                if (aborted) return;
                if (options.failOn === name && options.failOnce !== false) {
                  options.failOnce = false;
                  aborted = true;
                  tx.error = new Error("Simulated migration disk failure");
                  tx.onabort?.();
                  return;
                }
                if (index >= staged.length) { req.result = null; req.onsuccess?.(); return; }
                const idx = index++;
                req.result = {
                  value: structuredClone(staged[idx]),
                  update(record) { staged[idx] = structuredClone(record); },
                  continue: forward
                };
                req.onsuccess?.();
              });
              forward();
              return req;
            }
          };
        }
      };
      setTimeout(() => {
        if (settled) return;
        settled = true;
        if (!aborted) { committed[name] = staged; tx.oncomplete?.(); }
      }, 7);
      return tx;
    }
  };
}
test("migration backfills all stores with one transaction each and leaves IDs intact", async () => {
  const seed = {
    people: [{ id: "legacy", name: "Legacy", createdAt: "2024-01-01T00:00:00Z" }],
    interactions: [{ id: "i", personId: "legacy", schemaVersion: 7 }]
  };
  const db = legacyDb(seed);
  const report = {};
  const result = await repairPersonaLegacySchemas(db, ["people", "interactions"], 7, report);
  assert.deepEqual(result, { checked: 2, backfilled: 1, storesCommitted: 2 });
  assert.equal(report.recordsChecked, 2);
  assert.equal(report.schemaBackfilled, 1);
  assert.equal(db.snapshot().people[0].schemaVersion, 7);
  assert.equal(db.snapshot().people[0].id, "legacy");
  assert.equal(db.snapshot().interactions[0].id, "i");
  assert.deepEqual(db.states, ["people", "interactions"]);
  const repeat = await repairPersonaLegacySchemas(db, ["people", "interactions"], 7, {});
  assert.equal(repeat.backfilled, 0, "Rerunning migrations must not rewrite completed data");
});
test("mid-migration abort leaves that store intact and retries idempotently", async () => {
  const original = {
    people: [{ id: "p", name: "Example" }],
    observations: [{ id: "o", personId: "p" }, { id: "o2", personId: "p" }]
  };
  const db = legacyDb(original, { failOn: "observations", failOnce: true });
  const report = {};
  await assert.rejects(repairPersonaLegacySchemas(db, ["people", "observations"], 7, report), /Simulated migration/);
  assert.equal(db.snapshot().people[0].schemaVersion, 7, "Earlier committed store should remain complete");
  assert.deepEqual(db.snapshot().observations, original.observations, "Failed store must roll back without partial writes");
  const rerun = await repairPersonaLegacySchemas(db, ["people", "observations"], 7, {});
  assert.equal(rerun.backfilled, 2, "Retry must finish remaining legacy records");
  assert.equal(db.snapshot().observations[0].schemaVersion, 7);
  assert.equal(db.snapshot().observations[1].schemaVersion, 7);
});
test("Today, navigation badges and follow-up report agree after snooze expiry", () => {
  const today = "2026-10-13";
  assert.equal(personaV4IsFollowUpDue({ status: "snoozed", dueDate: "2026-10-16" }, today), false);
  assert.equal(personaV4IsFollowUpDue({ status: "snoozed", dueDate: "2026-10-12" }, today), true);
  assert.equal(personaV4IsFollowUpDue({ status: "snoozed", dueDate: "2026-10-13" }, today), true);
  assert.equal(personaV4IsFollowUpDue({ status: "done", dueDate: "2026-10-12" }, today), false);
  assert.equal(personaV4IsFollowUpDue({ completed: true, dueDate: "2026-10-12" }, today), false);
  assert.equal(personaV4IsFollowUpDue({ cancelled: true, dueDate: "2026-10-12" }, today), false);
  assert.equal(personaV4IsFollowUpDue({ dueDate: null }, today), true);
  for (const marker of [
    'async function ensurePersonaV4SchemaRepair()',
    'await repairPersonaLegacySchemas(await openDb(), STORES, SCHEMA_VERSION, report);',
    'if (await ensurePersonaV4SchemaRepair()) await loadAll();',
    'await personaAtomicRestore(await openDb(), Object.fromEntries(STORES.map((s) => [s, []])))',
    'const today = todayLocal();',
    'if (!personaV4IsFollowUpDue(f, today)) return;',
    'localStorage.removeItem("persona.v4.schemaRepair.v1")',
    'External AI configured'
  ]) assert.ok(html.includes(marker), "Expected production safety hook: " + marker);
  const todaySource = html.slice(html.indexOf("  function todayItems() {"), html.indexOf("  function relationshipBriefing() {"));
  assert.equal(todaySource.includes('if (f.status === "done" || f.status === "snoozed") return;'), false,
    "Expired snoozes must reappear in the Today task view");
});
