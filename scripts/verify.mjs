import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const indexPath = resolve(root, "index.html");
const html = await readFile(indexPath, "utf8");
const info = await stat(indexPath);

function has(text, message) {
  assert.ok(html.includes(text), message || `Missing: ${text}`);
}
function lacks(text, message) {
  assert.equal(html.includes(text), false, message || `Forbidden: ${text}`);
}

assert.ok(info.size > 800_000, "Production bundle unexpectedly shrank; possible destructive rewrite");
has("PERSONA_HARDENING_RUNTIME_START", "Hardening runtime was not injected");
has('APP_VERSION = "3.1.1";', "App version is not v3.1.1");
has("SCHEMA_VERSION = 7;", "Schema version changed unexpectedly");
has('ANALYTICS_ENGINE_VERSION = "3.1";', "Analytics version changed unexpectedly");
has('AI_ENGINE_VERSION = "2.1";', "AI engine version changed unexpectedly");
has('EXPORT_FORMAT_VERSION = "3.1";', "Export format version changed unexpectedly");

lacks('version: "2.0"', "Obsolete hard-coded backup version remains");
lacks('aiApiKey: ""', "API key remains in default persistent settings");
lacks("settings.aiApiKey", "Runtime still reads API key from persistent settings");
lacks("s.aiApiKey", "Runtime still reads API key from persistent settings");
lacks("setSettings({ aiApiKey", "API key can still be written through persistent settings");
lacks('value="${esc2(s.aiApiKey)}"', "Raw API key is rendered into the DOM");
lacks("API integration is a scaffold for future providers", "Outdated external-AI settings copy remains");

has('SESSION_API_KEY = "persona.secret.aiApiKey.session"', "Session secret namespace is missing");
has("var SecretStore = createSecretStore();", "Central SecretStore is missing");
has("const migrated = migrateLegacySettings(parsed, SecretStore);", "Legacy settings migration is missing");
has("Object.assign(state.settings, sanitizePersistentSettings(patch));", "Persistent settings sanitization is missing");
has("const safe = sanitizeSecretsDeep(stored) || [];", "IndexedDB secret scrub is missing");
has("SecretStore.clearApiKey();", "Secret clearing behavior is missing");
has("const data = buildBackupPayload(s.settings, s.data);", "Normal backup does not use canonical payload builder");
has("const payload = buildBackupPayload(s.settings, s.data);", "Encrypted backup does not use canonical payload builder");
has('schemaVersion: SCHEMA_VERSION', "Backup metadata lacks schema version");
has('exportFormatVersion: EXPORT_FORMAT_VERSION', "Backup metadata lacks export format version");
has("prepareImportedSettings(parsed && parsed.settings)", "Import credential stripping is missing");
has("External AI credentials were not restored for security", "Restore security notice is missing");

has("validateExternalAIEndpoint", "Endpoint validation is missing");
has("shouldUseExternalAI(s)", "Local/external mode gate is missing");
has("SecretStore.getApiKey()", "Provider does not read from SecretStore");
has("openAICompatibleChat(fetch", "External AI transport hardening is missing");
has("Remote external AI endpoints must use HTTPS.", "Remote HTTPS enforcement is missing");
has("External AI request failed: HTTP ", "Safe HTTP failure reporting is missing");
has("External AI response was not valid JSON.", "Malformed response handling is missing");

assert.equal(/console\.(?:log|warn|error|debug)[^\n]*(?:Authorization|apiKey|Bearer)/i.test(html), false, "Credential-bearing console logging detected");
assert.equal(/localStorage\.(?:setItem|getItem)[^\n]*persona\.secret\.aiApiKey\.session/i.test(html), false, "Session API key is referenced through localStorage");

// Epistemic and relationship-intelligence regression markers must remain in the final bundle.
for (const marker of [
  "Relationship Playbook",
  "playbookHistory",
  "Situation Intelligence",
  "signals",
  "experiments",
  "Decision Lab",
  "Copilot",
  "counter-evidence",
  "Never diagnose personality or mental health",
  "Never estimate IQ",
  "observed",
  "hypothesis",
  "prediction"
]) has(marker, `Regression marker missing: ${marker}`);

// The deliverable must remain self-contained: no runtime JS/CSS/service-worker assets are required.
assert.equal(/<script[^>]+src\s*=\s*["'][^"']+["']/i.test(html), false, "External script dependency detected");
assert.equal(/<link[^>]+rel\s*=\s*["']stylesheet["'][^>]+href\s*=\s*["'][^"']+["']/i.test(html), false, "External stylesheet dependency detected");
lacks('navigator.serviceWorker.register("service-worker.js")', "Orphaned external service-worker dependency remains");
has("Single-file build: no external service-worker asset is required or requested.", "Single-file service-worker policy marker missing");

// Compile the inline scripts without executing DOM/storage code. This catches syntax damage from the deterministic patcher.
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
assert.ok(scripts.length >= 1, "No inline application script found");
for (const source of scripts) {
  // eslint-disable-next-line no-new-func
  new Function(source);
}

const sentinel = "PERSONA_TEST_SECRET_DO_NOT_EXPORT_7f21";
lacks(sentinel, "Test secret leaked into production output");

console.log(`verify: PASS (${info.size} bytes, ${scripts.length} inline script(s) syntax-checked)`);
