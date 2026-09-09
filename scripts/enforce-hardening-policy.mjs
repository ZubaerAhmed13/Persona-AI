import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const indexPath = resolve(here, "../index.html");
let html = await readFile(indexPath, "utf8");

function replaceExactlyOnce(oldText, newText, label) {
  const count = html.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${label}: expected 1 match, found ${count}`);
  html = html.replace(oldText, newText);
}

// The safety backup must represent the state BEFORE imported settings/data are applied.
const oldImportOrder = `      const { db: db2, exportJSON: exportJSON2 } = await Promise.all([Promise.resolve().then(() => (init_storage(), storage_exports)), Promise.resolve().then(() => (init_export(), export_exports))]);
      // Normal backup restore intentionally clears session credentials.
      SecretStore.clearApiKey();
      if (parsed && parsed.settings) setSettings(importedSettings.settings);
      const snapshot = buildBackupPayload(getState().settings, getState().data);
      snapshot.reason = "pre-import-safety";
      const { download: download2 } = await Promise.resolve().then(() => (init_utils(), utils_exports));
      download2("persona-safety-backup.json", JSON.stringify(snapshot, null, 2), "application/json");`;
const newImportOrder = `      const { db: db2, exportJSON: exportJSON2 } = await Promise.all([Promise.resolve().then(() => (init_storage(), storage_exports)), Promise.resolve().then(() => (init_export(), export_exports))]);
      // Capture the current non-secret state before replacing settings or data.
      const snapshot = buildBackupPayload(getState().settings, getState().data);
      snapshot.reason = "pre-import-safety";
      const { download: download2 } = await Promise.resolve().then(() => (init_utils(), utils_exports));
      download2("persona-safety-backup.json", JSON.stringify(snapshot, null, 2), "application/json");
      // Normal backup restore intentionally clears session credentials.
      SecretStore.clearApiKey();
      if (parsed && parsed.settings) setSettings(importedSettings.settings);`;

if (html.includes(oldImportOrder)) {
  html = html.replace(oldImportOrder, newImportOrder);
} else if (!html.includes(newImportOrder)) {
  // Support a clean pre-hardening source if this build policy is reused from an older artifact.
  const vanilla = `      const { db: db2, exportJSON: exportJSON2 } = await Promise.all([Promise.resolve().then(() => (init_storage(), storage_exports)), Promise.resolve().then(() => (init_export(), export_exports))]);
      const snapshot = buildBackupPayload(getState().settings, getState().data);
      snapshot.reason = "pre-import-safety";
      const { download: download2 } = await Promise.resolve().then(() => (init_utils(), utils_exports));
      download2("persona-safety-backup.json", JSON.stringify(snapshot, null, 2), "application/json");`;
  const hardened = `${vanilla}
      // Normal backup restore intentionally clears session credentials.
      SecretStore.clearApiKey();
      if (parsed && parsed.settings) setSettings(importedSettings.settings);`;
  replaceExactlyOnce(vanilla, hardened, "normal import credential policy");
}

// A reset can call loadSettings(), which intentionally migrates a legacy persisted API key
// into SecretStore for the current session. Clear again AFTER that migration/save so reset
// has a strict postcondition: no API key remains in the session.
const resetTail = `    const s = loadSettings();
    saveSettings({ ...s, onboardingDone: false });
  }`;
const resetTailHardened = `    const s = loadSettings();
    saveSettings({ ...s, onboardingDone: false });
    // Reset postcondition: even a just-migrated legacy credential is gone.
    SecretStore.clearApiKey();
  }`;
if (html.includes(resetTail)) {
  replaceExactlyOnce(resetTail, resetTailHardened, "reset secret postcondition");
} else if (!html.includes(resetTailHardened)) {
  throw new Error("reset secret postcondition: hardened reset tail not found");
}

// Persona v3.1.1 remains a genuine single-file deliverable. The historical bundle still
// attempted to register service-worker.js even though that asset is not shipped or deployed.
// Under HTTP/GitHub Pages this caused a guaranteed 404 and a browser console error. Keep the
// existing boot call stable, but make the registration hook intentionally dependency-free.
const legacyServiceWorkerRegistration = `  function registerSW() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("service-worker.js").catch(() => {
      });
    }
  }`;
const singleFileServiceWorkerHook = `  function registerSW() {
    // Single-file build: no external service-worker asset is required or requested.
  }`;
if (html.includes(legacyServiceWorkerRegistration)) {
  replaceExactlyOnce(legacyServiceWorkerRegistration, singleFileServiceWorkerHook, "single-file service worker policy");
} else if (!html.includes(singleFileServiceWorkerHook)) {
  throw new Error("single-file service worker policy: expected registration hook not found");
}

await writeFile(indexPath, html, "utf8");
console.log("Enforced Persona restore/reset/single-file hardening policy");
