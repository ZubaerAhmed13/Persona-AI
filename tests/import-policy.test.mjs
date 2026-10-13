import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
async function productionHtml() {
  return readFile(resolve(here, "../index.html"), "utf8");
}

test("plaintext and encrypted restore share validation, safety backup, and atomic commit", async () => {
  const html = await productionHtml();
  const normal = html.slice(html.indexOf("  async function safeImport(parsed) {"), html.indexOf("  function openAuditLog()"));
  const encrypted = html.slice(html.indexOf("  function importEncrypted() {"), html.indexOf("  async function safeImport(parsed) {"));
  const common = html.slice(html.indexOf("  async function applyVerifiedBackup("), html.indexOf("  function importEncrypted() {"));
  for (const source of [normal, encrypted]) {
    const validated = source.indexOf("validatePersonaBackup(parsed, STORES");
    const restored = source.indexOf("applyVerifiedBackup(parsed, data, importedSettings)");
    assert.ok(validated >= 0 && restored > validated,
      "Both restore paths must reject invalid backups before atomic data mutation");
    assert.ok(source.includes("prepareImportedSettings(parsed && parsed.settings)"));
    assert.ok(source.includes("sanitizeSecretsDeep(parsed.data)"));
  }
  const positions = [
    "const snapshot = buildBackupPayload(getState().settings, getState().data);",
    'download2("persona-safety-backup.json"',
    "await db2.replaceStoresAtomically(data);",
    "SecretStore.clearApiKey();",
    "if (parsed && parsed.settings) setSettings(importedSettings.settings);"
  ].map((marker) => common.indexOf(marker));
  assert.ok(positions.every((p) => p >= 0) && positions.every((p, i) => i === 0 || p > positions[i - 1]),
    "Safety snapshot and download must precede atomic replace, which must precede secret/settings updates");
  assert.equal(common.includes("await db2.clear("), false, "Non-atomic store-by-store import reintroduced");
});

test("person deletion uses a single DB transaction and explicitly deletes primary person id", async () => {
  const html = await productionHtml();
  const start = html.indexOf("  function deletePerson(id) {");
  const end = html.indexOf("  function greeting() {", start);
  const source = html.slice(start, end);
  assert.ok(source.includes("await db2.deletePersonGraphAtomically(id);"));
  assert.ok(source.includes("await loadAll2();"));
  assert.ok(html.includes('tx.objectStore("people").delete(personId);'));
  assert.ok(html.includes('store.index("personId").openKeyCursor('));
  assert.equal(source.includes('filter((x) => x.personId === id)'), false, "Old orphaning person cascade reintroduced");
});

test("complete reset has a final secret-clear postcondition after legacy settings migration", async () => {
  const html = await productionHtml();
  const start = html.indexOf("  async function resetAll() {");
  const end = html.indexOf("  var DB_NAME", start);
  assert.ok(start >= 0 && end > start, "resetAll function not found");
  const source = html.slice(start, end);
  const loadPos = source.indexOf("const s = loadSettings();");
  const savePos = source.indexOf("saveSettings({ ...s, onboardingDone: false });");
  const finalClearPos = source.lastIndexOf("SecretStore.clearApiKey();");
  assert.ok(loadPos >= 0 && savePos > loadPos, "reset settings migration/save flow missing");
  assert.ok(finalClearPos > savePos, "reset must clear SecretStore after any legacy migration can run");
  assert.ok(source.includes("Reset postcondition: even a just-migrated legacy credential is gone."));
});
