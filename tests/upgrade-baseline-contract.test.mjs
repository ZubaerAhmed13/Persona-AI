// Persona AI 4.0, Stage 1: non-mutating compatibility contract.
// These tests intentionally pin the v3.1.1 feature/data baseline. If a later
// stage changes a contract, update it only alongside a tested migration plan.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const html = await readFile(new URL("index.html", root), "utf8");
const backup = JSON.parse(await readFile(new URL("tests/fixtures/v3.1-full-backup.json", root), "utf8"));

const EXPECTED_STORES = [
  "people", "interactions", "observations", "favors", "commitments",
  "predictions", "preferences", "boundaryEvents", "conflictEvents",
  "supportEvents", "statements", "memories", "decisions", "weeklyReviews",
  "selfReflections", "followUps", "reminders", "surprises", "changeOfMinds",
  "monthlyReviews", "auditLog", "openLoops", "expectations", "debriefs",
  "lessons", "playbooks", "playbookHistory", "signals", "signalHistory",
  "situations", "experiments", "decisionOptions", "relationshipGoals"
];

const EXPECTED_ROUTES = [
  "dashboard", "people", "interactions", "journal", "patterns",
  "reciprocity", "reliability", "communication", "predictions",
  "relationships", "reports", "data", "settings", "privacy", "help",
  "initiative", "boundaries", "conflict", "support", "context",
  "preferences", "decisions", "memory", "judgment", "weekly", "monthly",
  "commitments", "copilot", "openloops", "playbook", "situations",
  "signals", "decisionlab", "experiments"
];

function indexedDbStoreIds(markup) {
  const block = markup.match(/\bSTORES\s*=\s*\[([\s\S]*?)\]\s*;/);
  assert.ok(block, "IndexedDB store declaration missing; update compatibility tests when modularizing");
  return [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function handlerRouteIds(markup) {
  const block = markup.match(/const handlers = \{([\s\S]*?)\n\s*\};/);
  assert.ok(block, "View handler registry missing; update compatibility tests when modularizing");
  return [...block[1].matchAll(/^\s*([a-z][a-zA-Z0-9]*):\s*render[A-Z]\w*,?$/gm)].map((match) => match[1]);
}

test("stage 1: production artifact retains the existing database identity and versions", () => {
  assert.match(html, /\bDB_NAME\s*=\s*"persona-ai"\s*;/);
  assert.match(html, /\bDB_VERSION\s*=\s*5\s*;/);
  assert.match(html, /\bSCHEMA_VERSION\s*=\s*7\s*;/);
  assert.match(html, /\bAPP_VERSION\s*=\s*"3\.1\.1"\s*;/);
  assert.match(html, /\bEXPORT_FORMAT_VERSION\s*=\s*"3\.1"\s*;/);
  assert.ok(html.includes("persona.settings.v1"), "Existing settings key cannot silently change");
  assert.ok(html.includes("persona.meta.v1"), "Existing metadata key cannot silently change");
});

test("stage 1: every existing IndexedDB store remains present, with the same names", () => {
  const actual = indexedDbStoreIds(html);
  assert.equal(actual.length, 33, "Expected all 33 existing stores");
  assert.equal(new Set(actual).size, 33, "Duplicate store declarations");
  assert.deepEqual([...actual].sort(), [...EXPECTED_STORES].sort());
  assert.match(html, /createObjectStore\(s,\s*\{\s*keyPath:\s*"id"\s*\}\)/);
  assert.match(html, /createIndex\("personId",\s*"personId"/);
});

test("stage 1: archived v3.1 backup fixture covers the full persistence contract", () => {
  assert.equal(backup.app, "PERSONA AI");
  assert.equal(backup.appVersion, "3.1");
  assert.equal(backup.schemaVersion, 7);
  assert.equal(backup.exportFormatVersion, "3.1");
  assert.deepEqual(Object.keys(backup.data).sort(), [...EXPECTED_STORES].sort());
  for (const [store, records] of Object.entries(backup.data)) {
    assert.ok(Array.isArray(records) && records.length > 0, store + " fixture missing records");
    const ids = records.map((record) => record.id);
    assert.ok(ids.every((id) => typeof id === "string" && id.length > 0), store + " fixture has invalid id");
    assert.equal(new Set(ids).size, ids.length, store + " fixture contains duplicate ids");
  }
  assert.equal(Object.hasOwn(backup.settings, "aiApiKey"), false, "Backup fixture must remain credential-free");
});

test("stage 1: all 34 baseline destinations still have rendering handlers", () => {
  const routes = handlerRouteIds(html);
  assert.equal(routes.length, 34, "Expected all 34 existing view handlers");
  assert.deepEqual([...routes].sort(), [...EXPECTED_ROUTES].sort());
});

test("stage 1: core capture, navigation, search and backup affordances remain available", () => {
  for (const action of [
    "quickCapture", "universalCapture", "addPerson", "addDecision",
    "addMemory", "addCommitment", "addPrediction", "addFollowUp",
    "backup", "restoreEncrypted"
  ]) {
    assert.ok(html.includes('data-action="' + action + '"'), "Missing action: " + action);
  }
  for (const id of ["globalSearchInput", "contextPersonSelect", "sidebar", "mobileNav", "view"]) {
    assert.ok(html.includes('id="' + id + '"'), "Missing element: " + id);
  }
  assert.ok(html.includes("PERSONA_HARDENING_RUNTIME_START"), "Hardening integration missing");
  assert.ok(html.includes("persona.secret.aiApiKey.session"), "Session-only credential handling missing");
  assert.ok(html.includes("buildBackupPayload("), "Backup policy missing");
});

test("stage 1: published bundle remains self-contained and source tests are non-mutating", () => {
  assert.doesNotMatch(html, /<script[^>]+src\s*=\s*["'][^"']+["']/i);
  assert.doesNotMatch(html, /<link[^>]+rel\s*=\s*["']stylesheet["'][^>]+href\s*=\s*["'][^"']+["']/i);
});
