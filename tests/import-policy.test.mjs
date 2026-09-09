import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

async function productionHtml() {
  return readFile(resolve(here, "../index.html"), "utf8");
}

test("normal JSON restore creates safety backup before applying imported settings and clears session credentials", async () => {
  const html = await productionHtml();
  const start = html.indexOf("  async function safeImport(parsed) {");
  const end = html.indexOf("  function openAuditLog()", start);
  assert.ok(start >= 0 && end > start, "safeImport function not found");
  const source = html.slice(start, end);

  const snapshotPos = source.indexOf("const snapshot = buildBackupPayload(getState().settings, getState().data);");
  const downloadPos = source.indexOf('download2("persona-safety-backup.json"');
  const clearPos = source.indexOf("SecretStore.clearApiKey();");
  const settingsPos = source.indexOf("if (parsed && parsed.settings) setSettings(importedSettings.settings);");

  assert.ok(snapshotPos >= 0 && downloadPos > snapshotPos, "pre-import safety backup is missing");
  assert.ok(clearPos > downloadPos, "session secret must be cleared after the pre-import safety backup is captured");
  assert.ok(settingsPos > clearPos, "imported settings must be applied only after session secret clearing");
  assert.ok(source.includes("// Capture the current non-secret state before replacing settings or data."));
  assert.ok(source.includes("const importedSettings = prepareImportedSettings(parsed && parsed.settings);"));
  assert.equal(source.includes("setSettings({ aiApiKey"), false);
});

test("encrypted JSON restore clears current session credentials and applies sanitized settings", async () => {
  const html = await productionHtml();
  const decryptAnchor = html.indexOf("const parsed = await decryptBackupJSON(encData, pw);");
  const safeImportStart = html.indexOf("  async function safeImport(parsed) {", decryptAnchor);
  assert.ok(decryptAnchor >= 0 && safeImportStart > decryptAnchor, "encrypted restore block not found");
  const source = html.slice(Math.max(0, decryptAnchor - 2500), safeImportStart);
  assert.ok(source.includes("const importedSettings = prepareImportedSettings(parsed && parsed.settings);"));
  assert.ok(source.includes("SecretStore.clearApiKey();"));
  assert.ok(source.includes("if (parsed && parsed.settings) setSettings(importedSettings.settings);"));
  assert.ok(source.includes("sanitizeSecretsDeep(parsed && parsed.data"));
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
