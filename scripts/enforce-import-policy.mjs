import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const indexPath = resolve(here, "../index.html");
let html = await readFile(indexPath, "utf8");

const marker = "// Normal backup restore intentionally clears session credentials.";
if (!html.includes(marker)) {
  const anchor = `      const { db: db2, exportJSON: exportJSON2 } = await Promise.all([Promise.resolve().then(() => (init_storage(), storage_exports)), Promise.resolve().then(() => (init_export(), export_exports))]);\n      const snapshot = buildBackupPayload(getState().settings, getState().data);`;
  const replacement = `      const { db: db2, exportJSON: exportJSON2 } = await Promise.all([Promise.resolve().then(() => (init_storage(), storage_exports)), Promise.resolve().then(() => (init_export(), export_exports))]);\n      ${marker}\n      SecretStore.clearApiKey();\n      if (parsed && parsed.settings) setSettings(importedSettings.settings);\n      const snapshot = buildBackupPayload(getState().settings, getState().data);`;
  const matches = html.split(anchor).length - 1;
  if (matches !== 1) throw new Error(`normal import hardening anchor: expected 1 match, found ${matches}`);
  html = html.replace(anchor, replacement);
}

await writeFile(indexPath, html, "utf8");
console.log("Enforced normal-import session credential clearing and safe settings restore");
