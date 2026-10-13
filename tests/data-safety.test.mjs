import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validatePersonaBackup, personaAtomicRestore, personaAtomicDeletePerson } from "../src/safety/data-safety.mjs";

const contract = JSON.parse(await readFile(new URL("./contracts/v3.1.1.contract.json", import.meta.url), "utf8"));
const historical = JSON.parse(await readFile(new URL("./fixtures/v3.1-full-backup.json", import.meta.url), "utf8"));
const stores = contract.storeNames;
const clone = (v) => structuredClone(v);

function checked(backup, existing = {}) {
  return validatePersonaBackup(backup, stores, existing, 7);
}
test("historical v3.1 full fixture remains readable without modifying record IDs", () => {
  const before = JSON.stringify(historical);
  const result = checked(historical);
  assert.deepEqual(result, { ok: true, errors: [] });
  assert.equal(JSON.stringify(historical), before);
  for (const name of stores) assert.equal(historical.data[name].length, 1);
});
test("legacy backup without newer version fields is accepted", () => {
  const backup = { app: "PERSONA AI", version: "2.0", data: { people: [{ id: "legacy-1", name: "Example" }] } };
  assert.equal(checked(backup).ok, true);
});
test("valid partial backup uses existing linked people without clearing other stores", () => {
  const backup = { app: "PERSONA AI", data: { followUps: [{ id: "f1", personId: "retained-person" }] } };
  assert.equal(checked(backup, { people: [{ id: "retained-person", name: "Example" }] }).ok, true);
});
test("invalid backup identity, schema, settings and unknown stores fail closed", () => {
  for (const backup of [
    null, {}, { app: "PERSONA AI" },
    { app: "PERSONA AI", data: [] },
    { app: "PERSONA AI", data: {} },
    { app: "PERSONA AI", data: { unknown: [] } },
    { app: "PERSONA AI", schemaVersion: 8, data: { people: [] } },
    { app: "PERSONA AI", exportFormatVersion: "99", data: { people: [] } },
    { app: "PERSONA AI", settings: [], data: { people: [] } }
  ]) assert.equal(checked(backup).ok, false, JSON.stringify(backup));
});
test("bad record types, repeated/missing IDs, dates and future record versions are rejected", () => {
  for (const bad of [
    [{ id: "x", name: "Ok" }, { id: "x", name: "Dup" }],
    [{ name: "No ID" }],
    ["not a record"],
    [{ id: "x", name: "" }],
    [{ id: "x", name: "Name", schemaVersion: 12 }],
    [{ id: "x", name: "Name", createdAt: "not a date" }]
  ]) assert.equal(checked({ app: "PERSONA AI", data: { people: bad } }).ok, false, JSON.stringify(bad));
});
test("missing person and cross-record references, including partial import orphaning, are blocked", () => {
  assert.equal(checked({ app: "PERSONA AI", data: { interactions: [{ id: "i", personId: "missing" }] } }).ok, false);
  assert.equal(checked({ app: "PERSONA AI", data: { people: [{ id: "new", name: "New" }] } },
    { interactions: [{ id: "old-linked", personId: "old" }] }).ok, false);
  assert.equal(checked({ app: "PERSONA AI", data: { playbookHistory: [{ id: "h", playbookId: "ghost" }] } }).ok, false);
  assert.equal(checked({ app: "PERSONA AI", data: { decisionOptions: [{ id: "d", decisionId: "ghost" }] } }).ok, false);
});

function fakeDb(initial, { failPutAt = Infinity, failDelete = false } = {}) {
  let live = Object.fromEntries(Object.entries(initial).map(([key, records]) =>
    [key, new Map(records.map((r) => [r.id, clone(r)]))]));
  let puts = 0;
  const present = () => Object.fromEntries(Object.entries(live).map(([key, value]) => [key, [...value.values()].map(clone)]));
  return {
    present,
    transaction(names) {
      const staged = Object.fromEntries(Object.entries(live).map(([k, v]) => [k, new Map(v)]));
      let aborted = false;
      const tx = {
        error: null, oncomplete: null, onabort: null,
        abort() { aborted = true; queueMicrotask(() => tx.onabort?.()); },
        objectStore(name) {
          if (!names.includes(name)) throw Error("Out of scope store");
          return {
            clear() { staged[name].clear(); },
            put(record) {
              if (++puts === failPutAt) throw Error("Simulated quota or invalid record");
              staged[name].set(record.id, clone(record));
            },
            delete(id) {
              if (failDelete) throw Error("Simulated deletion failure");
              staged[name].delete(id);
            },
            openCursor() {
              const ids = [...staged[name].keys()];
              let index = 0;
              const request = { onsuccess: null, result: null };
              const advance = () => queueMicrotask(() => {
                if (aborted) return;
                const id = ids[index++];
                const value = staged[name].get(id);
                request.result = id === undefined ? null : {
                  primaryKey: id,
                  value: clone(value),
                  delete() { staged[name].delete(id); },
                  continue: advance
                };
                request.onsuccess?.();
              });
              advance();
              return request;
            },
            index(field) {
              assert.equal(field, "personId");
              return {
                openKeyCursor(range) {
                  const ids = [...staged[name].values()].filter((r) => r.personId === range.id).map((r) => r.id);
                  let index = 0;
                  const request = { onsuccess: null, result: null };
                  const advance = () => queueMicrotask(() => {
                    if (aborted) return;
                    const id = ids[index++];
                    request.result = id === undefined ? null : { primaryKey: id, continue: advance };
                    request.onsuccess?.();
                  });
                  advance();
                  return request;
                }
              };
            }
          };
        }
      };
      setTimeout(() => {
        if (!aborted) { live = staged; tx.oncomplete?.(); }
      }, 5);
      return tx;
    }
  };
}
const keyRange = { only(id) { return { id }; } };
test("a successful atomic restore replaces selected stores without touching others", async () => {
  const db = fakeDb({ people: [{ id: "old", name: "Old" }], followUps: [{ id: "f", text: "Keep" }] });
  await personaAtomicRestore(db, { people: [{ id: "new", name: "New" }] });
  assert.deepEqual(db.present(), { people: [{ id: "new", name: "New" }], followUps: [{ id: "f", text: "Keep" }] });
});
test("a failed atomic restore aborts and preserves all old stores", async () => {
  const initial = { people: [{ id: "old", name: "Old" }], followUps: [{ id: "f", text: "Keep" }] };
  const db = fakeDb(initial, { failPutAt: 2 });
  await assert.rejects(personaAtomicRestore(db, {
    people: [{ id: "new", name: "New" }],
    followUps: [{ id: "f2", text: "Replace" }]
  }), /Simulated/);
  assert.deepEqual(db.present(), initial);
});
test("person deletion deletes primary key and every linked record, preserving unrelated data", async () => {
  const db = fakeDb({
    people: [{ id: "p1", name: "One" }, { id: "p2", name: "Two" }],
    interactions: [{ id: "i1", personId: "p1" }, { id: "i2", personId: "p2" }],
    auditLog: [
      { id: "a", personId: "p1" },
      { id: "a2", store: "people", recordId: "p1" },
      { id: "a3", store: "people", recordId: "p2" }
    ]
  });
  await personaAtomicDeletePerson(db, ["people", "interactions", "auditLog"], "p1", keyRange);
  assert.deepEqual(db.present(), {
    people: [{ id: "p2", name: "Two" }],
    interactions: [{ id: "i2", personId: "p2" }],
    auditLog: [{ id: "a3", store: "people", recordId: "p2" }]
  });
});
test("deleting a person removes provably owned indirect links and audit traces without touching another person", async () => {
  const initial = {
    people: [{ id: "p1", name: "One" }, { id: "p2", name: "Two" }],
    playbooks: [{ id: "pb1", personId: "p1" }, { id: "pb2", personId: "p2" }],
    signals: [{ id: "sg1", personId: "p1" }, { id: "sg2", personId: "p2" }],
    decisions: [{ id: "d1", personId: "p1" }, { id: "d2", personId: "p2" }],
    playbookHistory: [
      { id: "h1", playbookId: "pb1" },
      { id: "h2", playbookId: "pb2" },
      { id: "h_other", personId: "p2", playbookId: "pb1" }
    ],
    signalHistory: [
      { id: "sh1", signalId: "sg1" },
      { id: "sh2", signalId: "sg2" }
    ],
    decisionOptions: [
      { id: "do1", decisionId: "d1" },
      { id: "do2", decisionId: "d2" }
    ],
    auditLog: [
      { id: "a1", store: "playbooks", recordId: "pb1" },
      { id: "a2", store: "playbookHistory", recordId: "h1" },
      { id: "a3", store: "decisionOptions", recordId: "do1" },
      { id: "a4", store: "signals", recordId: "sg2" },
      { id: "a5", store: "people", recordId: "p2" },
      { id: "a6", store: "people", recordId: "p1", personId: "p2" }
    ]
  };
  const db = fakeDb(initial);
  await personaAtomicDeletePerson(db, Object.keys(initial), "p1", keyRange);
  assert.deepEqual(db.present(), {
    people: [{ id: "p2", name: "Two" }],
    playbooks: [{ id: "pb2", personId: "p2" }],
    signals: [{ id: "sg2", personId: "p2" }],
    decisions: [{ id: "d2", personId: "p2" }],
    playbookHistory: [
      { id: "h2", playbookId: "pb2" },
      { id: "h_other", personId: "p2", playbookId: "pb1" }
    ],
    signalHistory: [{ id: "sh2", signalId: "sg2" }],
    decisionOptions: [{ id: "do2", decisionId: "d2" }],
    auditLog: [
      { id: "a4", store: "signals", recordId: "sg2" },
      { id: "a5", store: "people", recordId: "p2" },
      { id: "a6", store: "people", recordId: "p1", personId: "p2" }
    ]
  });
});

test("an indirect-record deletion failure rolls back the full multi-store transaction", async () => {
  const initial = {
    people: [{ id: "p1", name: "One" }],
    playbooks: [{ id: "pb1", personId: "p1" }],
    playbookHistory: [{ id: "h1", playbookId: "pb1" }]
  };
  const db = fakeDb(initial, { failDelete: true });
  await assert.rejects(personaAtomicDeletePerson(db, Object.keys(initial), "p1", keyRange), /Simulated/);
  assert.deepEqual(db.present(), initial);
});

test("failed person deletion aborts and keeps primary person + relationships intact", async () => {
  const seed = { people: [{ id: "p1", name: "One" }], interactions: [{ id: "i1", personId: "p1" }] };
  const db = fakeDb(seed, { failDelete: true });
  await assert.rejects(personaAtomicDeletePerson(db, ["people", "interactions"], "p1", keyRange), /Simulated/);
  assert.deepEqual(db.present(), seed);
});
