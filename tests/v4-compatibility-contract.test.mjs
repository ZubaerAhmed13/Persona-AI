// Persona AI v4 Stage 1: read-only historical compatibility gates.
// These tests must never open a real user's IndexedDB or modify user data.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeBackupPayload, prepareImportedSettings } from "../src/hardening/runtime.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = await readFile(resolve(root, "index.html"), "utf8");
const contract = JSON.parse(await readFile(resolve(root, "tests/contracts/v3.1.1.contract.json"), "utf8"));
const fixture = JSON.parse(await readFile(resolve(root, "tests/fixtures/v3.1-full-backup.json"), "utf8"));
const sorted = (values) => [...values].sort();
const unique = (values) => new Set(values).size === values.length;

function capture(re, source, label) {
  const found = source.match(re);
  assert.ok(found, label + " not found in production source");
  return found[1];
}
function assignment(name, kind = "string") {
  const value = capture(new RegExp("\\b" + name + "\\s*=\\s*" + (kind === "number" ? "(\\d+)" : '"([^"]+)"') + ";"), html, name);
  return kind === "number" ? Number(value) : value;
}
function inventory() {
  const storeBlock = capture(/\bSTORES\s*=\s*\[([\s\S]*?)\]\s*;/, html, "STORES array");
  const renderBlock = capture(/function render\(\) \{[\s\S]*?const handlers = \{([\s\S]*?)\};/, html, "view render dispatcher");
  const actionBlock = capture(/function handleAction\(act, arg, el\) \{([\s\S]*?)\n  function /, html, "action dispatcher");
  return {
    stores: [...storeBlock.matchAll(/"([^"]+)"/g)].map((match) => match[1]),
    routes: [...html.matchAll(/<button class="nav-item"\s+data-view="([^"]+)"\s+aria-label="([^"]+)"/g)].map((match) => ({ id: match[1], label: match[2] })),
    handlers: [...renderBlock.matchAll(/^\s*(\w+): render\w+,?$/gm)].map((match) => match[1]),
    actions: [...actionBlock.matchAll(/case "([^"]+)":/g)].map((match) => match[1]),
    modules: [...new Set([...html.matchAll(/\/\/ js\/([A-Za-z0-9_-]+\.js)/g)].map((match) => match[1]))]
  };
}
const current = inventory();

test("legacy 33-store DB identity, schema versions, and IndexedDB indexes stay intact", () => {
  assert.equal(contract.storeNames.length, 33, "Invalid committed baseline");
  assert.ok(unique(contract.storeNames), "Baseline store IDs contain duplicates");
  assert.deepEqual(current.stores, contract.storeNames, "The IndexedDB store set or order changed: provide migration plan and fixture proof");
  assert.equal(assignment("DB_NAME"), contract.databaseName);
  assert.equal(assignment("DB_VERSION", "number"), contract.databaseVersion);
  assert.equal(assignment("DATA_VERSION", "number"), contract.dataVersion);
  assert.equal(assignment("SCHEMA_VERSION", "number"), contract.schemaVersion);
  assert.match(html, /db2\.createObjectStore\(s,\s*\{\s*keyPath:\s*"id"\s*\}\)/, "Historical primary key was changed");
  for (const index of contract.objectStoreIndexes) {
    assert.ok(html.includes('os.createIndex("' + index + '", "' + index + '", { unique: false })'), "Historical index missing: " + index);
  }
  assert.match(html, /indexedDB\.open\(DB_NAME,\s*DB_VERSION\)/);
});

test("34 legacy sidebar routes and render handlers survive (additional routes allowed)", () => {
  assert.equal(contract.navigationRoutes.length, 34, "Invalid committed route baseline");
  assert.ok(unique(contract.navigationRoutes.map((route) => route.id)), "Duplicate historical routes");
  assert.ok(unique(current.routes.map((route) => route.id)), "Duplicate live sidebar route");
  for (const old of contract.navigationRoutes) {
    assert.ok(current.routes.some((route) => route.id === old.id && route.label === old.label), "Historical route/label removed: " + old.id);
    assert.ok(current.handlers.includes(old.id), "Navigation destination lacks renderer: " + old.id);
  }
  for (const handler of contract.renderHandlers) {
    assert.ok(current.handlers.includes(handler), "Historical renderer removed: " + handler);
  }
});

test("all historical dispatched action names and source module sections remain discoverable", () => {
  assert.equal(contract.actionDispatcherNames.length, 112, "Invalid committed action baseline");
  assert.ok(unique(contract.actionDispatcherNames), "Historical action IDs are ambiguous");
  assert.ok(unique(current.actions), "Current action dispatcher defines duplicate action IDs");
  for (const action of contract.actionDispatcherNames) {
    assert.ok(current.actions.includes(action), "Historical action deleted: " + action);
  }
  for (const module of contract.bundledModuleSections) {
    assert.ok(current.modules.includes(module), "Historical bundled module absent: " + module);
  }
  for (const flow of [
    "openPersonForm", "openInteractionForm", "openCommitmentForm", "openPredictionForm",
    "openMemoryForm", "openFollowUpForm", "openExperimentForm", "openUniversalCapture",
    "openQuickCapture", "initSearch", "searchAll", "completeFollowUp",
    "snoozeFollowUp", "deleteRecord", "deletePerson"
  ]) {
    assert.match(html, new RegExp("\\bfunction " + flow + "\\s*\\("), "Historical workflow missing: " + flow);
  }
});

test("runtime, analytics, AI, export, and settings version contracts remain stable", () => {
  for (const [sourceKey, contractKey] of [
    ["APP_VERSION", "appVersion"],
    ["ANALYTICS_ENGINE_VERSION", "analyticsEngineVersion"],
    ["AI_ENGINE_VERSION", "aiEngineVersion"],
    ["EXPORT_FORMAT_VERSION", "exportFormatVersion"],
    ["SETTINGS_KEY", "settingsKey"]
  ]) {
    assert.equal(assignment(sourceKey), contract[contractKey], sourceKey + " changed without a versioned compatibility review");
  }
  const defaults = capture(/defaultSettings\s*=\s*\{([\s\S]*?)\n\s*\};/, html, "default settings");
  for (const key of contract.defaultSettingsKeys) {
    assert.match(defaults, new RegExp("\\b" + key + "\\s*:"), "Historical settings field missing: " + key);
  }
  assert.match(html, /setSettings\(patch\)/, "Settings update entry point removed");
  assert.match(html, /localStorage\.getItem\(SETTINGS_KEY\)/, "Settings persistence key no longer read");
});

test("historical full-backup fixture covers every store and preserves record relationships", () => {
  assert.equal(fixture.app, "PERSONA AI");
  assert.equal(fixture.schemaVersion, contract.schemaVersion);
  assert.ok(fixture.exportFormatVersion === contract.exportFormatVersion);
  assert.deepEqual(sorted(Object.keys(fixture.data)), sorted(contract.storeNames));
  const ids = new Map();
  for (const store of contract.storeNames) {
    const records = fixture.data[store];
    assert.ok(Array.isArray(records) && records.length > 0, "Fixture store has no records: " + store);
    const storeIds = records.map((record) => record.id);
    assert.ok(storeIds.every((id) => typeof id === "string" && id.length > 0), "Fixture record lacks a persistent ID in " + store);
    assert.ok(unique(storeIds), "Duplicate historical IDs in " + store);
    ids.set(store, new Set(storeIds));
  }
  for (const [store, records] of Object.entries(fixture.data)) {
    for (const record of records) {
      if (record.personId) assert.ok(ids.get("people").has(record.personId), store + " references a missing person");
      if (record.playbookId) assert.ok(ids.get("playbooks").has(record.playbookId), "Orphan playbook history");
      if (record.signalId) assert.ok(ids.get("signals").has(record.signalId), "Orphan signal history");
      if (record.decisionId) assert.ok(ids.get("decisions").has(record.decisionId), "Orphan decision option");
    }
  }
  const before = JSON.stringify(fixture);
  const imported = prepareImportedSettings(fixture.settings);
  const backup = makeBackupPayload(imported.settings, fixture.data, {
    app: "PERSONA AI", version: contract.appVersion,
    schemaVersion: contract.schemaVersion, exportFormatVersion: contract.exportFormatVersion,
    exportedAt: "2026-01-01T00:00:00.000Z"
  });
  for (const store of contract.storeNames) {
    assert.deepEqual(
      backup.data[store].map((record) => record.id),
      fixture.data[store].map((record) => record.id),
      "Canonical backup altered historical IDs in " + store
    );
  }
  assert.equal(JSON.stringify(fixture), before, "Fixture mutated by backup/restore preparation");
});

test("backup formats, safety ordering, and encrypted-restore entry points remain reachable", () => {
  for (const marker of [
    'format: "persona-encrypted-v1"', '"PBKDF2"', '"AES-GCM"',
    'function encryptBackupJSON(', 'function decryptBackupJSON(',
    'function exportJSON(', 'function exportEncrypted(',
    'function importEncrypted(', 'async function safeImport(',
    'function applyVerifiedBackup(',
    'const snapshot = buildBackupPayload(getState().settings, getState().data);',
    'download2("persona-safety-backup.json"',
    'await db2.replaceStoresAtomically(data);',
    'personaAtomicDeletePerson(await openDb(), STORES, personId)',
    'function resetAll('
  ]) assert.ok(html.includes(marker), "Backup/restore compatibility marker missing: " + marker);
  const flow = capture(/async function applyVerifiedBackup\(parsed, data, importedSettings\) \{([\s\S]*?)\n  function importEncrypted/, html, "safeRestore");
  const snapshot = flow.indexOf("const snapshot = buildBackupPayload(");
  const atomic = flow.indexOf("await db2.replaceStoresAtomically(data)");
  const settings = flow.indexOf("setSettings(importedSettings.settings)");
  assert.ok(snapshot >= 0 && atomic > snapshot && settings > atomic,
    "Atomic restore must capture backup before commit, then apply settings only after commit");
});

test("local-first and credential isolation boundaries remain present", () => {
  assert.equal(html.includes('SESSION_API_KEY = "' + contract.sessionCredentialKey + '"'), true);
  assert.match(html, /function createSecretStore\(/);
  assert.match(html, /function sanitizeSecretsDeep\(/);
  assert.match(html, /shouldUseExternalAI\(s\)/);
  assert.match(html, /function runCopilotPipeline\(/);
  assert.match(html, /function copilotEvidencePacket\(/);
  assert.match(html, /openAICompatibleChat\(fetch/);
  assert.match(html, /function initWorker\(/);
  assert.match(html, /function searchAll\(/);
  assert.doesNotMatch(html, /<script[^>]*\bsrc\s*=/i, "Single-file runtime gained external JavaScript");
  assert.doesNotMatch(html, /<link[^>]*rel\s*=\s*["']stylesheet["'][^>]*\bhref\s*=/i, "Single-file runtime gained external CSS");
  assert.doesNotMatch(html, /navigator\.serviceWorker\.register\("service-worker\.js"\)/);
});

test("v3.1.1 baseline remains immutable and production file remains self-contained", () => {
  assert.equal(contract.productionGitBlobSha, "11cb846e8b11a0d3a3ea4806e3c1c5c1136b7fb5", "Historical v3.1.1 reference was rewritten");
  assert.ok(Buffer.byteLength(html, "utf8") > 800_000, "Production file unexpectedly shrank");
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length >= 1);
  for (const [, source] of scripts) new Function(source);
  // Deliberately revised production files are still gated by CI: npm run build
  // must produce byte-identical index.html to the committed PR artifact.
});

test("existing automation remains part of the protection suite", async () => {
  const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  for (const name of ["build", "test", "verify", "test:browser", "test:acceptance", "test:features", "check"]) {
    assert.equal(typeof pkg.scripts[name], "string", "Required regression command missing: " + name);
  }
  assert.match(pkg.scripts.test, /node --test tests\/\*\.test\.mjs/);
  const workflow = await readFile(resolve(root, ".github/workflows/hardening.yml"), "utf8");
  for (const gate of ["npm run build", "npm test", "npm run verify", "npm run test:browser", "npm run test:acceptance", "npm run test:features"]) {
    assert.ok(workflow.includes(gate), "CI is missing gate: " + gate);
  }
});
