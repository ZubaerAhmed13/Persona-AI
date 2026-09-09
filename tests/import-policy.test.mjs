import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

test("normal JSON restore clears current session credentials and applies only sanitized imported settings", async () => {
  const html = await readFile(resolve(here, "../index.html"), "utf8");
  const start = html.indexOf("  async function safeImport(parsed) {");
  const end = html.indexOf("  function openAuditLog()", start);
  assert.ok(start >= 0 && end > start, "safeImport function not found");
  const source = html.slice(start, end);
  assert.ok(source.includes("// Normal backup restore intentionally clears session credentials."));
  assert.ok(source.includes("SecretStore.clearApiKey();"));
  assert.ok(source.includes("if (parsed && parsed.settings) setSettings(importedSettings.settings);"));
  assert.ok(source.includes("const importedSettings = prepareImportedSettings(parsed && parsed.settings);"));
  assert.equal(source.includes("setSettings({ aiApiKey"), false);
});

test("encrypted JSON restore also clears current session credentials and applies sanitized settings", async () => {
  const html = await readFile(resolve(here, "../index.html"), "utf8");
  const decryptAnchor = html.indexOf("const parsed = await decryptBackupJSON(encData, pw);");
  const safeImportStart = html.indexOf("  async function safeImport(parsed) {", decryptAnchor);
  assert.ok(decryptAnchor >= 0 && safeImportStart > decryptAnchor, "encrypted restore block not found");
  const source = html.slice(Math.max(0, decryptAnchor - 2500), safeImportStart);
  assert.ok(source.includes("const importedSettings = prepareImportedSettings(parsed && parsed.settings);"));
  assert.ok(source.includes("SecretStore.clearApiKey();"));
  assert.ok(source.includes("if (parsed && parsed.settings) setSettings(importedSettings.settings);"));
  assert.ok(source.includes("sanitizeSecretsDeep(parsed && parsed.data"));
});
