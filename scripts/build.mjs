import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  SECRET_SETTING_KEYS,
  SESSION_API_KEY,
  isSecretSettingKey,
  sanitizePersistentSettings,
  sanitizeSecretsDeep,
  createSecretStore,
  migrateLegacySettings,
  prepareImportedSettings,
  makeBackupPayload,
  validateExternalAIEndpoint,
  shouldUseExternalAI,
  openAICompatibleChat
} from "../src/hardening/runtime.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const indexPath = resolve(root, "index.html");
let html = await readFile(indexPath, "utf8");

function count(text, needle) {
  return text.split(needle).length - 1;
}

function replaceOnce(oldText, newText, label, alreadyText = null) {
  const n = count(html, oldText);
  if (n === 1) {
    html = html.replace(oldText, newText);
    return;
  }
  if (n > 1) throw new Error(`${label}: expected one match, found ${n}`);
  if (alreadyText && html.includes(alreadyText)) return;
  throw new Error(`${label}: source pattern not found and hardened form not detected`);
}

function insertAfterOnce(anchor, insertion, label, alreadyText) {
  if (alreadyText && html.includes(alreadyText)) return;
  replaceOnce(anchor, anchor + insertion, label);
}

const injectedFunctions = [
  isSecretSettingKey,
  sanitizePersistentSettings,
  sanitizeSecretsDeep,
  createSecretStore,
  migrateLegacySettings,
  prepareImportedSettings,
  makeBackupPayload,
  validateExternalAIEndpoint,
  shouldUseExternalAI,
  openAICompatibleChat
].map((fn) => fn.toString()).join("\n\n");

const runtimeBlock = `  /* PERSONA_HARDENING_RUNTIME_START */\n  var SECRET_SETTING_KEYS = Object.freeze(${JSON.stringify(SECRET_SETTING_KEYS)});\n  var SESSION_API_KEY = ${JSON.stringify(SESSION_API_KEY)};\n${injectedFunctions.split("\n").map((line) => "  " + line).join("\n")}\n  var SecretStore = createSecretStore();\n  function buildBackupPayload(settings, data) {\n    return makeBackupPayload(settings, data, {\n      app: "PERSONA AI",\n      version: APP_VERSION,\n      schemaVersion: SCHEMA_VERSION,\n      exportFormatVersion: EXPORT_FORMAT_VERSION,\n      exportedAt: (/* @__PURE__ */ new Date()).toISOString()\n    });\n  }\n  /* PERSONA_HARDENING_RUNTIME_END */`;

const runtimeRe = /  \/\* PERSONA_HARDENING_RUNTIME_START \*\/[\s\S]*?  \/\* PERSONA_HARDENING_RUNTIME_END \*\//;
if (runtimeRe.test(html)) {
  html = html.replace(runtimeRe, runtimeBlock);
} else {
  replaceOnce("  // js/storage.js", runtimeBlock + "\n\n  // js/storage.js", "inject hardening runtime");
}

replaceOnce('      APP_VERSION = "3.1";', '      APP_VERSION = "3.1.1";', "app version", '      APP_VERSION = "3.1.1";');
if (html.includes('        aiApiKey: "",\n')) html = html.replace('        aiApiKey: "",\n', "");

const oldSettingsFns = `  function loadSettings() {\n    try {\n      const raw = localStorage.getItem(SETTINGS_KEY);\n      const parsed = raw ? JSON.parse(raw) : {};\n      return { ...defaultSettings, ...parsed };\n    } catch {\n      return { ...defaultSettings };\n    }\n  }\n  function saveSettings(s) {\n    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));\n  }`;
const newSettingsFns = `  function loadSettings() {\n    try {\n      const raw = localStorage.getItem(SETTINGS_KEY);\n      const parsed = raw ? JSON.parse(raw) : {};\n      const migrated = migrateLegacySettings(parsed, SecretStore);\n      if (migrated.changed) localStorage.setItem(SETTINGS_KEY, JSON.stringify(migrated.settings));\n      return { ...defaultSettings, ...migrated.settings };\n    } catch {\n      return { ...defaultSettings };\n    }\n  }\n  function saveSettings(s) {\n    const safe = sanitizePersistentSettings(s);\n    localStorage.setItem(SETTINGS_KEY, JSON.stringify(safe));\n    if (s && typeof s === "object") {\n      for (const key of Object.keys(s)) if (isSecretSettingKey(key)) delete s[key];\n    }\n  }`;
replaceOnce(oldSettingsFns, newSettingsFns, "settings secret migration", "const migrated = migrateLegacySettings(parsed, SecretStore);");

insertAfterOnce("  async function resetAll() {", "\n    SecretStore.clearApiKey();", "reset clears session secret", "async function resetAll() {\n    SecretStore.clearApiKey();");

const oldLoadAll = `  async function loadAll() {\n    for (const s of STORES) state.data[s] = await db.getAll(s);\n    state.loaded = true;\n    emit("data", state.data);\n    return state.data;\n  }`;
const newLoadAll = `  async function loadAll() {\n    for (const s of STORES) {\n      const stored = await db.getAll(s);\n      const safe = sanitizeSecretsDeep(stored) || [];\n      state.data[s] = safe;\n      for (let i = 0; i < stored.length; i++) {\n        if (JSON.stringify(stored[i]) !== JSON.stringify(safe[i])) await db.put(s, safe[i]);\n      }\n    }\n    state.loaded = true;\n    emit("data", state.data);\n    return state.data;\n  }`;
replaceOnce(oldLoadAll, newLoadAll, "IndexedDB secret scrub", "const safe = sanitizeSecretsDeep(stored) || [];");

const oldSetSettings = `  function setSettings(patch) {\n    Object.assign(state.settings, patch);\n    saveSettings(state.settings);\n    emit("settings", state.settings);\n  }`;
const newSetSettings = `  function setSettings(patch) {\n    Object.assign(state.settings, sanitizePersistentSettings(patch));\n    for (const key of Object.keys(state.settings)) if (isSecretSettingKey(key)) delete state.settings[key];\n    saveSettings(state.settings);\n    emit("settings", state.settings);\n  }`;
replaceOnce(oldSetSettings, newSetSettings, "state settings sanitization", "Object.assign(state.settings, sanitizePersistentSettings(patch));");

const oldExport = `    const s = getState();\n    const data = { app: "PERSONA AI", version: "2.0", exportedAt: (/* @__PURE__ */ new Date()).toISOString(), settings: s.settings, data: s.data };`;
const newExport = `    const s = getState();\n    const data = buildBackupPayload(s.settings, s.data);`;
replaceOnce(oldExport, newExport, "normal backup canonical payload", "const data = buildBackupPayload(s.settings, s.data);");

const oldEncryptedPayload = `      const s = getState();\n      const payload = { app: "PERSONA AI", version: APP_VERSION, exportedAt: (/* @__PURE__ */ new Date()).toISOString(), settings: s.settings, data: s.data };`;
const newEncryptedPayload = `      const s = getState();\n      const payload = buildBackupPayload(s.settings, s.data);`;
replaceOnce(oldEncryptedPayload, newEncryptedPayload, "encrypted backup canonical payload", "const payload = buildBackupPayload(s.settings, s.data);");

const oldSafety = `      const snapshot = { app: "PERSONA AI", version: "safety-backup", exportedAt: (/* @__PURE__ */ new Date()).toISOString(), data: {} };\n      const stores = Object.keys(getState().data);\n      for (const st of stores) snapshot.data[st] = getState().data[st];`;
const newSafety = `      const snapshot = buildBackupPayload(getState().settings, getState().data);\n      snapshot.reason = "pre-import-safety";`;
replaceOnce(oldSafety, newSafety, "pre-import safety backup canonical payload", 'snapshot.reason = "pre-import-safety";');

const oldActive = `  async function activeProvider() {\n    const s = getState().settings;\n    if (s.aiEnabled && s.aiProvider === "api" && s.aiEndpoint) {\n      return new OpenAICompatibleProvider(s.aiEndpoint, s.aiApiKey, s.aiModel);\n    }\n    return LocalAnalyst;\n  }\n  function configureRemoteProvider(cfg) {\n    if (!cfg || !cfg.endpoint) return { ok: false, message: "An endpoint is required to enable external AI." };\n    return { ok: true, provider: new OpenAICompatibleProvider(cfg.endpoint, cfg.apiKey, cfg.model), note: "External AI configured. It will be used only when AI processing is enabled." };\n  }`;
const newActive = `  async function activeProvider() {\n    const s = getState().settings;\n    if (shouldUseExternalAI(s)) {\n      const checked = validateExternalAIEndpoint(s.aiEndpoint);\n      if (!checked.ok) throw new Error(checked.message);\n      return new OpenAICompatibleProvider(checked.url, SecretStore.getApiKey(), s.aiModel);\n    }\n    return LocalAnalyst;\n  }\n  function configureRemoteProvider(cfg) {\n    if (!cfg || !cfg.endpoint) return { ok: false, message: "An endpoint is required to enable external AI." };\n    const checked = validateExternalAIEndpoint(cfg.endpoint);\n    if (!checked.ok) return checked;\n    if (Object.prototype.hasOwnProperty.call(cfg, "apiKey")) SecretStore.setApiKey(cfg.apiKey);\n    return { ok: true, provider: new OpenAICompatibleProvider(checked.url, SecretStore.getApiKey(), cfg.model), note: "External AI configured. Relevant context is sent only for explicit external analysis operations." };\n  }`;
replaceOnce(oldActive, newActive, "external provider secret/endpoint hardening", "return new OpenAICompatibleProvider(checked.url, SecretStore.getApiKey(), s.aiModel);");

const oldChat = `        async chat(system, user, context) {\n          const res = await fetch(this.endpoint, {\n            method: "POST",\n            headers: { "Content-Type": "application/json", ...this.apiKey ? { "Authorization": "Bearer " + this.apiKey } : {} },\n            body: JSON.stringify({ model: this.model, messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature: 0.3 })\n          });\n          if (!res.ok) throw new Error("AI provider error: HTTP " + res.status);\n          const data = await res.json();\n          return data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : "";\n        }`;
const newChat = `        async chat(system, user, context) {\n          return openAICompatibleChat(fetch, this.endpoint, this.apiKey, this.model, system, user);\n        }`;
replaceOnce(oldChat, newChat, "safe external chat transport", "return openAICompatibleChat(fetch, this.endpoint, this.apiKey, this.model, system, user);");

replaceOnce(
  `      const provider = new OpenAICompatibleProvider(settings.aiEndpoint, settings.aiApiKey, settings.aiModel);`,
  `      const provider = await activeProvider();`,
  "copilot provider uses SecretStore",
  `      const provider = await activeProvider();`
);

const oldKeyField = `<div class="field"><label>API Key</label><input class="input" id="aiApiKey" type="password" value="\${esc2(s.aiApiKey)}" placeholder="Enter key (kept local)"></div>`;
const newKeyField = `<div class="field"><label>API Key</label><input class="input" id="aiApiKey" type="password" autocomplete="off" placeholder="\${SecretStore.hasApiKey() ? "Key configured for this session — enter to replace" : "Enter key for this browser session"}"><div class="hint" id="aiKeyStatus">\${SecretStore.hasApiKey() ? "Key configured for this session" : "No key configured for this session"}</div><button class="btn btn-sm" type="button" id="clearAiApiKey" style="margin-top:6px">Clear API key</button></div>`;
replaceOnce(oldKeyField, newKeyField, "API key DOM hardening", 'id="aiKeyStatus"');

replaceOnce(
  `          <p class="hint">API integration is a scaffold for future providers. Until a working endpoint is configured, the built-in local analyst remains the active engine.</p>`,
  `          <p class="hint">Persona can optionally use an OpenAI-compatible API for evidence-grounded analysis. Relevant context for the current request may be sent to the configured endpoint. The API key is kept only for this browser session and is never included in Persona backups.</p>`,
  "external AI settings copy",
  "The API key is kept only for this browser session and is never included in Persona backups."
);

const oldEndpointBinding = `    root().querySelector("#aiEndpoint")?.addEventListener("change", (e) => setSettings({ aiEndpoint: e.target.value }));`;
const newEndpointBinding = `    root().querySelector("#aiEndpoint")?.addEventListener("change", (e) => {\n      const raw = e.target.value.trim();\n      if (!raw) { setSettings({ aiEndpoint: "" }); return; }\n      const checked = validateExternalAIEndpoint(raw);\n      if (!checked.ok) {\n        toast(checked.message, "warn", "Invalid endpoint");\n        e.target.value = getState().settings.aiEndpoint || "";\n        return;\n      }\n      setSettings({ aiEndpoint: checked.url });\n      e.target.value = checked.url;\n    });`;
replaceOnce(oldEndpointBinding, newEndpointBinding, "endpoint UI validation", 'toast(checked.message, "warn", "Invalid endpoint");');

const oldKeyBinding = `    root().querySelector("#aiApiKey")?.addEventListener("change", (e) => setSettings({ aiApiKey: e.target.value }));`;
const newKeyBinding = `    root().querySelector("#aiApiKey")?.addEventListener("change", (e) => {\n      SecretStore.setApiKey(e.target.value);\n      e.target.value = "";\n      const status = root().querySelector("#aiKeyStatus");\n      if (status) status.textContent = SecretStore.hasApiKey() ? "Key configured for this session" : "No key configured for this session";\n      toast(SecretStore.hasApiKey() ? "API key configured for this browser session." : "API key cleared.", "ok");\n    });\n    root().querySelector("#clearAiApiKey")?.addEventListener("click", () => {\n      SecretStore.clearApiKey();\n      const keyInput = root().querySelector("#aiApiKey");\n      if (keyInput) keyInput.value = "";\n      const status = root().querySelector("#aiKeyStatus");\n      if (status) status.textContent = "No key configured for this session";\n      toast("API key cleared from this browser session.", "ok");\n    });`;
replaceOnce(oldKeyBinding, newKeyBinding, "session-only API key binding", 'root().querySelector("#clearAiApiKey")?.addEventListener("click"');

insertAfterOnce("  async function loadDemoAndGo() {", "\n    SecretStore.clearApiKey();", "demo loading clears secret", "async function loadDemoAndGo() {\n    SecretStore.clearApiKey();");

const encryptedParsedAnchor = `        const parsed = await decryptBackupJSON(encData, pw);`;
insertAfterOnce(encryptedParsedAnchor, `\n        const importedSettings = prepareImportedSettings(parsed && parsed.settings);\n        SecretStore.clearApiKey();\n        if (parsed && parsed.settings) setSettings(importedSettings.settings);`, "encrypted import strips credentials", "const importedSettings = prepareImportedSettings(parsed && parsed.settings);");

replaceOnce(
  `        const data = parsed && parsed.data && typeof parsed.data === "object" ? parsed.data : {};`,
  `        const data = sanitizeSecretsDeep(parsed && parsed.data && typeof parsed.data === "object" ? parsed.data : {}) || {};`,
  "encrypted import data sanitization",
  `const data = sanitizeSecretsDeep(parsed && parsed.data && typeof parsed.data === "object" ? parsed.data : {}) || {};`
);

replaceOnce(
  `        toast("Encrypted backup decrypted and restored.", "ok", "Restore complete");`,
  `        toast("Backup restored. External AI credentials were not restored for security. Enter the API key again if needed.", "ok", "Restore complete");`,
  "encrypted restore security notice",
  "External AI credentials were not restored for security. Enter the API key again if needed."
);

const safeImportData = `    const data = parsed && parsed.data && typeof parsed.data === "object" ? parsed.data : {};`;
const safeImportDataNew = `    const data = sanitizeSecretsDeep(parsed && parsed.data && typeof parsed.data === "object" ? parsed.data : {}) || {};\n    const importedSettings = prepareImportedSettings(parsed && parsed.settings);`;
replaceOnce(safeImportData, safeImportDataNew, "normal import secret sanitization", "const importedSettings = prepareImportedSettings(parsed && parsed.settings);");

const safeImportDbAnchor = `      const { db: db2, exportJSON: exportJSON2 } = await Promise.all([Promise.resolve().then(() => (init_storage(), storage_exports)), Promise.resolve().then(() => (init_export(), export_exports))]);`;
insertAfterOnce(safeImportDbAnchor, `\n      SecretStore.clearApiKey();\n      if (parsed && parsed.settings) setSettings(importedSettings.settings);`, "normal import clears credentials", "if (parsed && parsed.settings) setSettings(importedSettings.settings);");

replaceOnce(
  `      toast("Import applied. A safety backup was downloaded first.", "ok", "Import complete");`,
  `      toast("Backup restored. External AI credentials were not restored for security. Enter the API key again if needed. A safety backup was downloaded first.", "ok", "Import complete");`,
  "normal restore security notice",
  "A safety backup was downloaded first."
);

await writeFile(indexPath, html, "utf8");
console.log("Built Persona AI v3.1.1 hardened self-contained index.html");
