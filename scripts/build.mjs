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
import { validatePersonaBackup, personaAtomicRestore, personaAtomicDeletePerson } from "../src/safety/data-safety.mjs";
import { personaV4IsFollowUpOpen, personaV4IsFollowUpDue, personaV4InitWorkspace, personaV4SyncWorkspace, renderPersonaV4FollowUps } from "../src/ui/workspace.mjs";
import { personaCalendarDay, personaAddCalendarDays, personaRecordClosed, personaFollowUpOpen, personaFollowUpDue, personaSelectTodayItems, personaSelectWeekAhead } from "../src/domain/today.mjs";
import { personaRenderWeekAheadAgenda } from "../src/ui/agenda.mjs";
import { repairPersonaLegacySchemas } from "../src/safety/migration.mjs";
import { personaV4ActivityList, personaV4PersonSummary, personaV4FilterActivity } from "../src/domain/person-activity.mjs";
import { personaV4EscapeActivity, personaV4RenderActivityRows, personaV4RenderActivityShell, personaV4MountPeopleActivity, personaV4BindPeopleActivity } from "../src/ui/person-activity.mjs";

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

const safetyFunctions = [validatePersonaBackup, personaAtomicRestore, personaAtomicDeletePerson, repairPersonaLegacySchemas]
  .map((fn) => fn.toString()).join("\n\n");
const safetyBlock = "  /* PERSONA_V4_SAFETY_RUNTIME_START */\n" +
  safetyFunctions.split("\n").map((line) => "  " + line).join("\n") +
  "\n  /* PERSONA_V4_SAFETY_RUNTIME_END */";
const safetyRe = /  \/\* PERSONA_V4_SAFETY_RUNTIME_START \*\/[\s\S]*?  \/\* PERSONA_V4_SAFETY_RUNTIME_END \*\//;
if (safetyRe.test(html)) {
  html = html.replace(safetyRe, safetyBlock);
} else {
  replaceOnce("  // js/storage.js", safetyBlock + "\n\n  // js/storage.js", "inject Persona v4 safety runtime");
}

// Stage 2 UI remains a deterministic, offline-only build input.
const workspaceCss = await readFile(resolve(root, "src/ui/workspace.css"), "utf8");
const workspaceCssBlock = "\n/* PERSONA_V4_WORKSPACE_CSS_START */\n" +
  workspaceCss.trimEnd() + "\n/* PERSONA_V4_WORKSPACE_CSS_END */\n";
const workspaceCssRe = /\n\/\* PERSONA_V4_WORKSPACE_CSS_START \*\/[\s\S]*?\/\* PERSONA_V4_WORKSPACE_CSS_END \*\/\n/;
if (workspaceCssRe.test(html)) html = html.replace(workspaceCssRe, workspaceCssBlock);
else {
  const close = html.indexOf("</style>");
  if (close < 0) throw new Error("Persona v4 workspace head style block missing");
  html = html.slice(0, close) + workspaceCssBlock + html.slice(close);
}
const workspaceFns = [personaV4IsFollowUpOpen, personaV4IsFollowUpDue, personaV4InitWorkspace, personaV4SyncWorkspace, renderPersonaV4FollowUps]
  .map((fn) => fn.toString()).join("\n\n");
const workspaceBlock = "  /* PERSONA_V4_WORKSPACE_RUNTIME_START */\n" +
  workspaceFns.split("\n").map((line) => "  " + line).join("\n") +
  "\n  /* PERSONA_V4_WORKSPACE_RUNTIME_END */";
const workspaceRe = /  \/\* PERSONA_V4_WORKSPACE_RUNTIME_START \*\/[\s\S]*?  \/\* PERSONA_V4_WORKSPACE_RUNTIME_END \*\//;
if (workspaceRe.test(html)) html = html.replace(workspaceRe, workspaceBlock);
else replaceOnce("  // js/storage.js", workspaceBlock + "\n\n  // js/storage.js", "inject Persona v4 workspace runtime");

// Stage 4: read-only People overview and six-source Activity timeline.
// Preserve legacy renderers, actions, schema, and local-first distribution.
const personActivityCss = await readFile(resolve(root, "src/ui/person-activity.css"), "utf8");
const personActivityCssBlock = "\n/* PERSONA_V4_PERSON_ACTIVITY_CSS_START */\n" +
  personActivityCss.trimEnd() + "\n/* PERSONA_V4_PERSON_ACTIVITY_CSS_END */\n";
const personActivityCssRe = /\n\/\* PERSONA_V4_PERSON_ACTIVITY_CSS_START \*\/[\s\S]*?\/\* PERSONA_V4_PERSON_ACTIVITY_CSS_END \*\/\n/;
if (personActivityCssRe.test(html)) html = html.replace(personActivityCssRe, personActivityCssBlock);
else {
  const close = html.indexOf("</style>");
  if (close < 0) throw new Error("Persona v4 People/Activity style insertion point missing");
  html = html.slice(0, close) + personActivityCssBlock + html.slice(close);
}

const personActivityFns = [
  personaV4ActivityList, personaV4PersonSummary, personaV4FilterActivity,
  personaV4EscapeActivity, personaV4RenderActivityRows, personaV4RenderActivityShell,
  personaV4MountPeopleActivity, personaV4BindPeopleActivity
];
const personActivityBlock = "  /* PERSONA_V4_PERSON_ACTIVITY_START */\n" +
  personActivityFns.map((fn) => fn.toString()).join("\n\n").split("\n").map((line) => "  " + line).join("\n") +
  "\n  /* PERSONA_V4_PERSON_ACTIVITY_END */";
const personActivityRe = /  \/\* PERSONA_V4_PERSON_ACTIVITY_START \*\/[\s\S]*?  \/\* PERSONA_V4_PERSON_ACTIVITY_END \*\//;
if (personActivityRe.test(html)) html = html.replace(personActivityRe, personActivityBlock);
else replaceOnce("  // js/storage.js", personActivityBlock + "\n\n  // js/storage.js", "inject Persona v4 People/Activity runtime");

replaceOnce(
  "    root().innerHTML = html;\n    injectHelpButton(v);",
  "    root().innerHTML = html;\n    personaV4MountPeopleActivity(v);\n    injectHelpButton(v);",
  "render Stage 4 People/Activity overlays",
  "    personaV4MountPeopleActivity(v);"
);
replaceOnce(
  "    bindFilters();\n  }\n  function bindReportSections()",
  "    bindFilters();\n    personaV4BindPeopleActivity();\n  }\n  function bindReportSections()",
  "bind Stage 4 People/Activity timeline",
  "    personaV4BindPeopleActivity();"
);

// Stage 3 read-only domain facade and optional dashboard agenda. Neither
// changes IndexedDB schema, existing action IDs, or legacy view dispatch.
const todayFns = [
  personaCalendarDay, personaAddCalendarDays, personaRecordClosed,
  personaFollowUpOpen, personaFollowUpDue,
  personaSelectTodayItems, personaSelectWeekAhead
];
const todayBlock = "  /* PERSONA_V4_TODAY_DOMAIN_START */\n" +
  todayFns.map((fn) => fn.toString()).join("\n\n").split("\n").map((line) => "  " + line).join("\n") +
  "\n  /* PERSONA_V4_TODAY_DOMAIN_END */";
const todayRe = /  \/\* PERSONA_V4_TODAY_DOMAIN_START \*\/[\s\S]*?  \/\* PERSONA_V4_TODAY_DOMAIN_END \*\//;
if (todayRe.test(html)) html = html.replace(todayRe, todayBlock);
else replaceOnce("  // js/storage.js", todayBlock + "\n\n  // js/storage.js", "inject Persona v4 Today domain");

const agendaBlock = "  /* PERSONA_V4_WEEK_AGENDA_START */\n" +
  personaRenderWeekAheadAgenda.toString().split("\n").map((line) => "  " + line).join("\n") +
  "\n  /* PERSONA_V4_WEEK_AGENDA_END */";
const agendaRe = /  \/\* PERSONA_V4_WEEK_AGENDA_START \*\/[\s\S]*?  \/\* PERSONA_V4_WEEK_AGENDA_END \*\//;
if (agendaRe.test(html)) html = html.replace(agendaRe, agendaBlock);
else replaceOnce("  // js/storage.js", agendaBlock + "\n\n  // js/storage.js", "inject Persona v4 agenda renderer");

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

// The v4 import screens already use shared validated atomic restore. Do not
// force obsolete v3.1 sequential-import patch text into these replacements.
if (!html.includes("  async function applyVerifiedBackup(parsed, data, importedSettings) {")) {
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
  
  const oldValidateDataset = `  function validateDataset(data) {\n    const report = { people: 0, interactions: 0, observations: 0, predictions: 0, others: 0, errors: 0, sampleIssues: [] };\n    const count = (obj) => obj && typeof obj === "object" ? obj : {};\n    Object.entries(data || {}).forEach(([store, list]) => {\n      if (!Array.isArray(list)) return;\n      if (store === "people") report.people += list.length;\n      else if (store === "interactions") report.interactions += list.length;\n      else if (store === "observations") report.observations += list.length;\n      else if (store === "predictions") report.predictions += list.length;\n      else report.others += list.length;\n      list.forEach((rec) => {\n        const v = validateRecord(store, rec);\n        if (!v.valid) {\n          report.errors++;\n          report.sampleIssues.push({ store, id: rec && rec.id, errors: v.errors.slice(0, 2) });\n        }\n      });\n    });\n    return report;\n  }`;
  const newValidateDataset = `  function validateDataset(data) {\n    const report = { people: 0, interactions: 0, observations: 0, predictions: 0, others: 0, errors: 0, sampleIssues: [] };\n    const importedPersonIds = new Set((Array.isArray(data && data.people) ? data.people : []).map((p) => p && p.id).filter(Boolean));\n    Object.entries(data || {}).forEach(([store, list]) => {\n      if (!Array.isArray(list)) return;\n      if (store === "people") report.people += list.length;\n      else if (store === "interactions") report.interactions += list.length;\n      else if (store === "observations") report.observations += list.length;\n      else if (store === "predictions") report.predictions += list.length;\n      else report.others += list.length;\n      list.forEach((rec) => {\n        const v = validateRecord(store, rec);\n        const errors = v.errors.filter((error) => !(error === "References a person that does not exist" && rec && rec.personId && importedPersonIds.has(rec.personId)));\n        if (errors.length) {\n          report.errors++;\n          report.sampleIssues.push({ store, id: rec && rec.id, errors: errors.slice(0, 2) });\n        }\n      });\n    });\n    return report;\n  }`;
  replaceOnce(oldValidateDataset, newValidateDataset, "import-aware dataset validation", "const importedPersonIds = new Set(");
  
  const safeImportData = `    const data = parsed && parsed.data && typeof parsed.data === "object" ? parsed.data : {};`;
  const safeImportDataNew = `    const data = sanitizeSecretsDeep(parsed && parsed.data && typeof parsed.data === "object" ? parsed.data : {}) || {};\n    const importedSettings = prepareImportedSettings(parsed && parsed.settings);`;
  replaceOnce(safeImportData, safeImportDataNew, "normal import secret sanitization", "const importedSettings = prepareImportedSettings(parsed && parsed.settings);");
  
  const badSafeImportDbAnchor = `      const { db: db2, exportJSON: exportJSON2 } = await Promise.all([Promise.resolve().then(() => (init_storage(), storage_exports)), Promise.resolve().then(() => (init_export(), export_exports))]);`;
  const safeImportDbAnchor = `      const [{ db: db2 }, { exportJSON: exportJSON2 }] = await Promise.all([Promise.resolve().then(() => (init_storage(), storage_exports)), Promise.resolve().then(() => (init_export(), export_exports))]);`;
  replaceOnce(badSafeImportDbAnchor, safeImportDbAnchor, "normal import dependency destructuring", safeImportDbAnchor);
  insertAfterOnce(safeImportDbAnchor, `\n      SecretStore.clearApiKey();\n      if (parsed && parsed.settings) setSettings(importedSettings.settings);`, "normal import clears credentials", "if (parsed && parsed.settings) setSettings(importedSettings.settings);");
  
  replaceOnce(
    `      toast("Import applied. A safety backup was downloaded first.", "ok", "Import complete");`,
    `      toast("Backup restored. External AI credentials were not restored for security. Enter the API key again if needed. A safety backup was downloaded first.", "ok", "Import complete");`,
    "normal restore security notice",
    "A safety backup was downloaded first."
  );
}


// Verified migration, reset, reminder, privacy, and boot-flow source transitions.
const v4PostmergePatches = [{"id":"legacy-migration","start":"  async function migrateV6ToV7(report) {","end":"  function ensureStore(db2, s) {","before":"  async function migrateV6ToV7(report) {\n    report.stage = \"v6 \\u2192 v7\";\n    const txStore = await openDb().then((db2) => db2.transaction(STORES, \"readwrite\"));\n    for (const s of STORES) {\n      const os = txStore.objectStore(s);\n      const recs = await new Promise((res) => {\n        const r = os.getAll();\n        r.onsuccess = () => res(r.result || []);\n        r.onerror = () => res([]);\n      });\n      report.recordsChecked += recs.length;\n      for (const r of recs) {\n        if (r && typeof r === \"object\" && !r.schemaVersion) {\n          const fixed = { ...r, schemaVersion: SCHEMA_VERSION, updatedAt: r.updatedAt || r.createdAt || (/* @__PURE__ */ new Date()).toISOString() };\n          os.put(fixed);\n          report.schemaBackfilled += 1;\n        }\n      }\n    }\n  }\n","after":"  async function migrateV6ToV7(report) {\n    report.stage = \"v6 → v7\";\n    await repairPersonaLegacySchemas(await openDb(), STORES, SCHEMA_VERSION, report);\n  }\n  async function ensurePersonaV4SchemaRepair() {\n    const marker = \"persona.v4.schemaRepair.v1\";\n    try { if (localStorage.getItem(marker) === \"done\") return false; } catch {}\n    const report = { recordsChecked: 0, schemaBackfilled: 0, stage: \"v6 → v7\" };\n    await migrateV6ToV7(report);\n    try {\n      localStorage.setItem(marker, \"done\");\n      if (report.schemaBackfilled) localStorage.setItem(\"persona.migration.lastReport\", JSON.stringify({\n        ...report, status: \"✓ Repaired\", recordsMigrated: report.schemaBackfilled\n      }));\n    } catch {}\n    return report.schemaBackfilled > 0;\n  }\n"},{"id":"atomic-snapshot","start":"  async function restoreSnapshot(snapshot) {","end":"  async function resetAll() {","before":"  async function restoreSnapshot(snapshot) {\n    for (const { store, data } of snapshot) {\n      await db.clear(store);\n      for (const rec of data) await db.put(store, rec);\n    }\n  }\n","after":"  async function restoreSnapshot(snapshot) {\n    const data = Object.fromEntries(snapshot.map(({ store, data }) => [store, data]));\n    await personaAtomicRestore(await openDb(), data);\n  }\n"},{"id":"atomic-reset","start":"  async function resetAll() {","end":"  var DB_NAME, DB_VERSION","before":"  async function resetAll() {\n    SecretStore.clearApiKey();\n    for (const s2 of STORES) await db.clear(s2);\n    localStorage.removeItem(\"persona.meta.v1\");\n    const s = loadSettings();\n    saveSettings({ ...s, onboardingDone: false });\n    // Reset postcondition: even a just-migrated legacy credential is gone.\n    SecretStore.clearApiKey();\n  }\n","after":"  async function resetAll() {\n    SecretStore.clearApiKey();\n    // One commit for all 33 stores: failed/aborted resets keep old records.\n    await personaAtomicRestore(await openDb(), Object.fromEntries(STORES.map((s) => [s, []])));\n    localStorage.removeItem(\"persona.meta.v1\");\n    const s = loadSettings();\n    saveSettings({ ...s, onboardingDone: false });\n    // Reset postcondition: even a just-migrated legacy credential is gone.\n    SecretStore.clearApiKey();\n  }\n"},{"id":"followup-local-date","start":"  function todayItems() {","end":"  function relationshipBriefing() {","before":"  function todayItems() {\n    const s = getState();\n    const out = [];\n    const now = /* @__PURE__ */ new Date();\n    const today = now.toISOString().slice(0, 10);\n    s.data.commitments.forEach((c) => {\n      const due = (c.expectedCompletion || \"\").slice(0, 10);\n      if (c.completed || c.cancelled) return;\n      const overdue = due && due < today;\n      const dueToday = due === today;\n      if (overdue || dueToday) out.push({ kind: \"commitment\", personId: c.personId, text: c.commitment, due, overdue, id: c.id });\n    });\n    s.data.predictions.forEach((p) => {\n      if (!p.outcome || p.outcome === \"pending\") out.push({ kind: \"prediction\", personId: p.personId, text: p.predictionText || p.target || \"Prediction\", due: p.date, id: p.id });\n    });\n    s.data.followUps.forEach((f) => {\n      if (f.status === \"done\" || f.status === \"snoozed\") return;\n      const due = (f.dueDate || \"\").slice(0, 10);\n      if (due <= today || !due) out.push({ kind: \"followUp\", personId: f.personId, text: f.text, due, id: f.id });\n    });\n    s.data.memories.forEach((m) => {\n      if (m.reminderDate && (m.reminderDate.slice(0, 10) === today || m.reminderDate.slice(0, 10) < today) && m.status !== \"done\") {\n        out.push({ kind: \"memory\", personId: m.personId, text: m.info, due: m.reminderDate, id: m.id });\n      }\n    });\n    out.forEach((i) => {\n      if (!i.due) i.due = now.toISOString();\n    });\n    return sortBy(out, \"due\");\n  }\n","after":"  function todayItems() {\n    const s = getState();\n    const out = [];\n    const now = /* @__PURE__ */ new Date();\n    const today = todayLocal();\n    s.data.commitments.forEach((c) => {\n      const due = (c.expectedCompletion || \"\").slice(0, 10);\n      if (c.completed || c.cancelled) return;\n      const overdue = due && due < today;\n      const dueToday = due === today;\n      if (overdue || dueToday) out.push({ kind: \"commitment\", personId: c.personId, text: c.commitment, due, overdue, id: c.id });\n    });\n    s.data.predictions.forEach((p) => {\n      if (!p.outcome || p.outcome === \"pending\") out.push({ kind: \"prediction\", personId: p.personId, text: p.predictionText || p.target || \"Prediction\", due: p.date, id: p.id });\n    });\n    s.data.followUps.forEach((f) => {\n      if (!personaV4IsFollowUpDue(f, today)) return;\n      const due = (f.dueDate || \"\").slice(0, 10);\n      out.push({ kind: \"followUp\", personId: f.personId, text: f.text, due, id: f.id });\n    });\n    s.data.memories.forEach((m) => {\n      if (m.reminderDate && (m.reminderDate.slice(0, 10) === today || m.reminderDate.slice(0, 10) < today) && m.status !== \"done\") {\n        out.push({ kind: \"memory\", personId: m.personId, text: m.info, due: m.reminderDate, id: m.id });\n      }\n    });\n    out.forEach((i) => {\n      if (!i.due) i.due = now.toISOString();\n    });\n    return sortBy(out, \"due\");\n  }\n"},{"id":"weekly-overdue","start":"      overdueFollowUps: workerPayload.followUps.filter(","end":"      people: workerPayload.people.length","before":"      overdueFollowUps: workerPayload.followUps.filter((f) => f.status !== \"done\" && f.status !== \"snoozed\" && f.dueDate && new Date(f.dueDate) <= now).length,\n","after":"      overdueFollowUps: workerPayload.followUps.filter((f) =>\n        Boolean(f.dueDate) && personaV4IsFollowUpDue(f, todayLocal())\n      ).length,\n"},{"id":"privacy-indicator","start":"  function updatePrivacyPill2() {","end":"  function toggleUserMenu() {","before":"  function updatePrivacyPill2() {\n    const pill = $(\"#privacyPill\");\n    const txt = $(\"#privacyPillText\");\n    const enabled = getState().settings.aiEnabled;\n    pill.classList.toggle(\"remote\", !!enabled);\n    txt.textContent = enabled ? \"AI enabled\" : \"Local-only\";\n  }\n","after":"  function updatePrivacyPill2() {\n    const pill = $(\"#privacyPill\");\n    const txt = $(\"#privacyPillText\");\n    const s = getState().settings;\n    // A local analyst being enabled is not evidence that data leaves this device.\n    const external = shouldUseExternalAI(s) && validateExternalAIEndpoint(s.aiEndpoint).ok;\n    pill.classList.toggle(\"remote\", external);\n    txt.textContent = external ? \"External AI configured\" : \"Local-only\";\n  }\n"},{"id":"startup-repair","start":"  async function boot() {","end":"  async function initBackupReminder() {","before":"  async function boot() {\n    initNav();\n    personaV4InitWorkspace();\n    initMobileNav();\n    registerSW();\n    initTopbar();\n    initQuickAdd();\n    initSearch();\n    initShortcuts();\n    applyTheme();\n    syncContextSelect();\n    updateThemeButton();\n    updateNotifBadge();\n    await loadAll();\n    const { loadDemo: loadDemo2 } = await Promise.resolve().then(() => (init_demo(), demo_exports));\n    if (getState().settings.demoMode && !getState().data.people.length) await loadDemo2();\n    syncContextSelect();\n    navigate2(\"dashboard\");\n    initOnboarding();\n    await initPatternNotifs();\n    await initBackupReminder();\n    await initOverdueReminder();\n    try {\n      const aut = await Promise.resolve().then(() => (init_automation(), automation_exports));\n      aut.runAutomation();\n    } catch (e) {\n    }\n    updatePrivacyPill2();\n    initUserMeta();\n    Promise.resolve().then(() => (init_views(), views_exports)).then((v) => {\n      if (getState().settings.lockMode === \"pin\" && getState().settings.locked) v.maybeLock();\n    });\n  }\n","after":"  async function boot() {\n    initNav();\n    personaV4InitWorkspace();\n    initMobileNav();\n    registerSW();\n    initTopbar();\n    initQuickAdd();\n    initSearch();\n    initShortcuts();\n    applyTheme();\n    syncContextSelect();\n    updateThemeButton();\n    updateNotifBadge();\n    await loadAll();\n    try {\n      if (await ensurePersonaV4SchemaRepair()) await loadAll();\n    } catch {\n      toast(\"Legacy record repair is still pending. Your data remains available; the app will retry next launch.\", \"warn\");\n    }\n    const { loadDemo: loadDemo2 } = await Promise.resolve().then(() => (init_demo(), demo_exports));\n    if (getState().settings.demoMode && !getState().data.people.length) await loadDemo2();\n    syncContextSelect();\n    navigate2(\"dashboard\");\n    initOnboarding();\n    await initPatternNotifs();\n    await initBackupReminder();\n    await initOverdueReminder();\n    try {\n      const aut = await Promise.resolve().then(() => (init_automation(), automation_exports));\n      aut.runAutomation();\n    } catch (e) {\n    }\n    updatePrivacyPill2();\n    initUserMeta();\n    Promise.resolve().then(() => (init_views(), views_exports)).then((v) => {\n      if (getState().settings.lockMode === \"pin\" && getState().settings.locked) v.maybeLock();\n    });\n  }\n"},{"id":"import-repair-retry","start":"  async function applyVerifiedBackup(parsed, data, importedSettings) {","end":"  function importEncrypted() {","before":"  async function applyVerifiedBackup(parsed, data, importedSettings) {\n    const { db: db2 } = await Promise.resolve().then(() => (init_storage(), storage_exports));\n    // Capture the current non-secret state before replacing settings or data.\n    const snapshot = buildBackupPayload(getState().settings, getState().data);\n    snapshot.reason = \"pre-import-safety\";\n    const { download: download2 } = await Promise.resolve().then(() => (init_utils(), utils_exports));\n    download2(\"persona-safety-backup.json\", JSON.stringify(snapshot, null, 2), \"application/json\");\n    await db2.replaceStoresAtomically(data);\n    // Credentials and settings are changed only when record transaction succeeded.\n    SecretStore.clearApiKey();\n    if (parsed && parsed.settings) setSettings(importedSettings.settings);\n  }\n","after":"  async function applyVerifiedBackup(parsed, data, importedSettings) {\n    const { db: db2 } = await Promise.resolve().then(() => (init_storage(), storage_exports));\n    // Capture the current non-secret state before replacing settings or data.\n    const snapshot = buildBackupPayload(getState().settings, getState().data);\n    snapshot.reason = \"pre-import-safety\";\n    const { download: download2 } = await Promise.resolve().then(() => (init_utils(), utils_exports));\n    download2(\"persona-safety-backup.json\", JSON.stringify(snapshot, null, 2), \"application/json\");\n    await db2.replaceStoresAtomically(data);\n    // A restored historical backup may need idempotent schema backfill on reload.\n    try { localStorage.removeItem(\"persona.v4.schemaRepair.v1\"); } catch {}\n    // Credentials and settings are changed only when record transaction succeeded.\n    SecretStore.clearApiKey();\n    if (parsed && parsed.settings) setSettings(importedSettings.settings);\n  }\n"}];
for (const p of v4PostmergePatches) {
  const start = html.indexOf(p.start), end = html.indexOf(p.end, start + p.start.length);
  if (start < 0 || end < 0) throw new Error("v4 integrity build marker absent: " + p.id);
  const existing = html.slice(start, end);
  // The Stage 3 Today selector replaces the older inline renderer only after
  // the historical migration patch has been certified.
  if (p.id === "followup-local-date" &&
      existing === "  function todayItems() {\n    return personaSelectTodayItems(getState().data, todayLocal(), new Date().toISOString());\n  }\n") continue;
  if (existing === p.after) continue;
  if (existing !== p.before) throw new Error("v4 integrity source drift: " + p.id);
  html = html.slice(0, start) + p.after + html.slice(end);
}


// Shared overdue/open-follow-up state across historical modules and Worker.
const v4FollowupPatches = [{"id":"local-analyst-and-weekly-open","oldText":"const fu = getState().data.followUps.filter((f) => f.status !== \"done\" && f.status !== \"snoozed\");","newText":"const fu = getState().data.followUps.filter((f) => personaV4IsFollowUpOpen(f, todayLocal()));","count":2},{"id":"open-loops-snooze","oldText":"if (f.status === \"done\" || f.status === \"snoozed\") return;","newText":"if (!personaV4IsFollowUpOpen(f, todayLocal())) return;","count":1},{"id":"copilot-promises","oldText":"const myFollowUps = s.data.followUps.filter((f) => (!pid || f.personId === pid) && f.status !== \"done\" && f.status !== \"snoozed\");","newText":"const myFollowUps = s.data.followUps.filter((f) => (!pid || f.personId === pid) && personaV4IsFollowUpOpen(f, todayLocal()));","count":1},{"id":"automation-due","oldText":"const due = s.data.followUps.filter((f) => f.status !== \"done\" && f.status !== \"snoozed\" && f.dueDate && new Date(f.dueDate) <= now);","newText":"const due = s.data.followUps.filter((f) => f.dueDate && personaV4IsFollowUpDue(f, todayLocal()));","count":1},{"id":"worker-due","oldText":"overdueFollowUps: followUps.filter(f => f.status !== \"done\" && f.status !== \"snoozed\" && f.dueDate && new Date(f.dueDate) <= new Date()).length,","newText":"overdueFollowUps: followUps.filter(f => f.dueDate && !f.completed && !f.cancelled && ![\"done\", \"completed\", \"cancelled\"].includes(String(f.status || \"\").toLowerCase()) && new Date(f.dueDate) <= new Date()).length,","count":1},{"id":"action-center","oldText":"const fuDue = s.data.followUps.filter((f) => f.status !== \"done\" && f.status !== \"snoozed\" && f.dueDate && new Date(f.dueDate) <= now).length;","newText":"const fuDue = s.data.followUps.filter((f) => f.dueDate && personaV4IsFollowUpDue(f, todayLocal())).length;","count":1}];
for (const patch of v4FollowupPatches) {
  const occurrences = html.split(patch.oldText).length - 1;
  if (occurrences === 0 && html.includes(patch.newText)) continue;
  if (occurrences !== patch.count) throw new Error("v4 reminder integration drift: " + patch.id + " (" + occurrences + ")");
  html = html.split(patch.oldText).join(patch.newText);
}

// Stage 3: replace only the exact historical Today selector. A failed exact
// match means the old source changed and must be re-audited before release.
replaceOnce("  function todayItems() {\n    const s = getState();\n    const out = [];\n    const now = /* @__PURE__ */ new Date();\n    const today = todayLocal();\n    s.data.commitments.forEach((c) => {\n      const due = (c.expectedCompletion || \"\").slice(0, 10);\n      if (c.completed || c.cancelled) return;\n      const overdue = due && due < today;\n      const dueToday = due === today;\n      if (overdue || dueToday) out.push({ kind: \"commitment\", personId: c.personId, text: c.commitment, due, overdue, id: c.id });\n    });\n    s.data.predictions.forEach((p) => {\n      if (!p.outcome || p.outcome === \"pending\") out.push({ kind: \"prediction\", personId: p.personId, text: p.predictionText || p.target || \"Prediction\", due: p.date, id: p.id });\n    });\n    s.data.followUps.forEach((f) => {\n      if (!personaV4IsFollowUpDue(f, today)) return;\n      const due = (f.dueDate || \"\").slice(0, 10);\n      out.push({ kind: \"followUp\", personId: f.personId, text: f.text, due, id: f.id });\n    });\n    s.data.memories.forEach((m) => {\n      if (m.reminderDate && (m.reminderDate.slice(0, 10) === today || m.reminderDate.slice(0, 10) < today) && m.status !== \"done\") {\n        out.push({ kind: \"memory\", personId: m.personId, text: m.info, due: m.reminderDate, id: m.id });\n      }\n    });\n    out.forEach((i) => {\n      if (!i.due) i.due = now.toISOString();\n    });\n    return sortBy(out, \"due\");\n  }\n", "  function todayItems() {\n    return personaSelectTodayItems(getState().data, todayLocal(), new Date().toISOString());\n  }\n", "extract Today read-only selector", "  function todayItems() {\n    return personaSelectTodayItems(getState().data, todayLocal(), new Date().toISOString());\n  }\n");
if (!html.includes("  ${personaRenderWeekAheadAgenda(s.data, todayLocal())}")) {
  replaceOnce("  ${saveResumeCard()}", "  ${personaRenderWeekAheadAgenda(s.data, todayLocal())}\n\n  ${saveResumeCard()}", "add seven-day agenda");
}

await writeFile(indexPath, html, "utf8");
console.log("Built Persona AI v3.1.1 hardened self-contained index.html");
