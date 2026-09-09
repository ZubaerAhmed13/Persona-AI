import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  SESSION_API_KEY,
  createSecretStore,
  sanitizePersistentSettings,
  sanitizeSecretsDeep,
  migrateLegacySettings,
  prepareImportedSettings,
  makeBackupPayload,
  validateExternalAIEndpoint,
  shouldUseExternalAI,
  openAICompatibleChat
} from "../src/hardening/runtime.mjs";

const TEST_SECRET = "PERSONA_TEST_SECRET_DO_NOT_EXPORT_7f21";
const META = {
  app: "PERSONA AI",
  version: "3.1.1",
  schemaVersion: 7,
  exportFormatVersion: "3.1",
  exportedAt: "2026-09-09T21:00:00.000Z"
};

class MemoryStorage {
  constructor(seed = {}) { this.map = new Map(Object.entries(seed)); }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
  entries() { return [...this.map.entries()]; }
}

function representativeData() {
  return {
    people: [{ id: "p1", name: "Alex" }, { id: "p2", name: "Maya" }],
    interactions: [{ id: "i1", personId: "p1", observed: "Followed up" }],
    memories: [{ id: "m1", personId: "p1", info: "Prefers concise messages" }],
    commitments: [{ id: "c1", personId: "p1", commitment: "Review draft", completed: false }],
    predictions: [{ id: "pr1", personId: "p1", predictionText: "Will respond", confidence: 60 }],
    followUps: [{ id: "f1", personId: "p1", text: "Check in" }],
    decisions: [{ id: "d1", personId: "p1", question: "Ask for help?" }],
    playbooks: [{ id: "pb1", personId: "p1", rule: "Direct request" }],
    situations: [{ id: "s1", personId: "p1", context: "Work" }],
    signals: [{ id: "sg1", personId: "p1", name: "Follow-through" }],
    experiments: [{ id: "e1", personId: "p1", hypothesis: "Direct asks work" }],
    relationshipGoals: [{ id: "g1", personId: "p1", goal: "Maintain contact" }]
  };
}

async function encryptLikePersona(payload, password) {
  const enc = new TextEncoder();
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const keyMaterial = await webcrypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await webcrypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  const ciphertext = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(payload)));
  const plaintext = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintext));
}

test("A — normal backup excludes API key and secret-like fields", () => {
  const storage = new MemoryStorage();
  const secretStore = createSecretStore(storage);
  secretStore.setApiKey(TEST_SECRET);
  const payload = makeBackupPayload(
    { aiEnabled: true, aiProvider: "api", aiApiKey: TEST_SECRET, aiEndpoint: "https://example.test/v1/chat", theme: "dark" },
    representativeData(),
    META
  );
  const json = JSON.stringify(payload);
  assert.equal(json.includes(TEST_SECRET), false);
  assert.equal(Object.hasOwn(payload.settings, "aiApiKey"), false);
  assert.equal(payload.settings.theme, "dark");
});

test("B — backup version and metadata come from authoritative inputs", () => {
  const payload = makeBackupPayload({}, {}, META);
  assert.equal(payload.app, "PERSONA AI");
  assert.equal(payload.version, "3.1.1");
  assert.equal(payload.schemaVersion, 7);
  assert.equal(payload.exportFormatVersion, "3.1");
  assert.equal(payload.exportedAt, META.exportedAt);
});

test("C — encrypted backup plaintext payload still contains no API key", async () => {
  const payload = makeBackupPayload({ aiApiKey: TEST_SECRET, aiProvider: "api" }, representativeData(), META);
  const decrypted = await encryptLikePersona(payload, "persona-test-password");
  assert.equal(JSON.stringify(decrypted).includes(TEST_SECRET), false);
  assert.equal(Object.hasOwn(decrypted.settings, "aiApiKey"), false);
});

test("D — persistent settings sanitizer removes credentials", () => {
  const persistent = sanitizePersistentSettings({
    theme: "system",
    aiEnabled: true,
    aiApiKey: TEST_SECRET,
    accessToken: TEST_SECRET,
    providerSecret: TEST_SECRET,
    aiEndpoint: "https://example.test/v1/chat"
  });
  const serialized = JSON.stringify(persistent);
  assert.equal(serialized.includes(TEST_SECRET), false);
  assert.deepEqual(persistent, {
    theme: "system",
    aiEnabled: true,
    aiEndpoint: "https://example.test/v1/chat"
  });
});

test("E — deep persisted-data scrub prevents API key fields reaching IndexedDB-shaped records", () => {
  const dbFixture = representativeData();
  dbFixture.people[0].aiApiKey = TEST_SECRET;
  dbFixture.interactions[0].providerToken = TEST_SECRET;
  const scrubbed = sanitizeSecretsDeep(dbFixture);
  assert.equal(JSON.stringify(scrubbed).includes(TEST_SECRET), false);
  assert.equal(scrubbed.people[0].name, "Alex");
  assert.equal(scrubbed.interactions[0].observed, "Followed up");
});

test("F — legacy settings migration is idempotent, preserves normal settings, and moves key only to session secret store", () => {
  const storage = new MemoryStorage();
  const secretStore = createSecretStore(storage);
  const first = migrateLegacySettings({ aiApiKey: TEST_SECRET, theme: "dark", aiModel: "model-x" }, secretStore);
  assert.equal(first.changed, true);
  assert.equal(first.settings.theme, "dark");
  assert.equal(first.settings.aiModel, "model-x");
  assert.equal(Object.hasOwn(first.settings, "aiApiKey"), false);
  assert.equal(secretStore.getApiKey(), TEST_SECRET);
  assert.equal(storage.getItem(SESSION_API_KEY), TEST_SECRET);

  const second = migrateLegacySettings(first.settings, secretStore);
  assert.equal(second.changed, false);
  assert.deepEqual(second.settings, first.settings);
});

test("G — legacy backup import discards credentials and does not auto-place them in session storage", () => {
  const storage = new MemoryStorage();
  const secretStore = createSecretStore(storage);
  const imported = prepareImportedSettings({ aiApiKey: TEST_SECRET, theme: "dark", aiModel: "legacy-model" });
  assert.equal(imported.hadCredentials, true);
  assert.equal(Object.hasOwn(imported.settings, "aiApiKey"), false);
  assert.equal(imported.settings.theme, "dark");
  assert.equal(secretStore.hasApiKey(), false);
});

test("H — reset primitive clears session secret immediately", () => {
  const storage = new MemoryStorage();
  const secretStore = createSecretStore(storage);
  secretStore.setApiKey(TEST_SECRET);
  assert.equal(secretStore.hasApiKey(), true);
  secretStore.clearApiKey();
  assert.equal(secretStore.hasApiKey(), false);
  assert.equal(storage.getItem(SESSION_API_KEY), null);
});

test("I — local mode and disabled external AI resolve to zero external calls", async () => {
  let calls = 0;
  const maybeCall = async (settings) => {
    if (!shouldUseExternalAI(settings)) return "local";
    calls += 1;
    return "external";
  };
  assert.equal(await maybeCall({ aiEnabled: true, aiProvider: "local", aiEndpoint: "https://example.test/v1/chat" }), "local");
  assert.equal(await maybeCall({ aiEnabled: false, aiProvider: "api", aiEndpoint: "https://example.test/v1/chat" }), "local");
  assert.equal(calls, 0);
});

test("J — explicit external operation sends expected request/auth but never logs credential", async () => {
  const requests = [];
  const logs = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => logs.push(args.join(" "));
  console.error = (...args) => logs.push(args.join(" "));
  try {
    const mockFetch = async (url, init) => {
      requests.push({ url, init });
      return { ok: true, status: 200, async json() { return { choices: [{ message: { content: "Evidence-grounded response" } }] }; } };
    };
    const answer = await openAICompatibleChat(
      mockFetch,
      "https://example.test/v1/chat/completions",
      TEST_SECRET,
      "test-model",
      "system guardrails",
      "only the relevant current evidence"
    );
    assert.equal(answer, "Evidence-grounded response");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://example.test/v1/chat/completions");
    assert.equal(requests[0].init.headers.Authorization, `Bearer ${TEST_SECRET}`);
    const body = JSON.parse(requests[0].init.body);
    assert.equal(body.model, "test-model");
    assert.equal(body.messages.length, 2);
    assert.equal(JSON.stringify(body).includes("people"), false, "Mock request unexpectedly contains a database dump");
    assert.equal(logs.join("\n").includes(TEST_SECRET), false);
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
});

test("endpoint policy requires HTTPS remotely, permits loopback HTTP, and rejects URL-embedded credentials", () => {
  assert.equal(validateExternalAIEndpoint("https://api.example.com/v1/chat").ok, true);
  assert.equal(validateExternalAIEndpoint("https://api.example.com/v1/chat?api-version=2026-01-01").ok, true);
  assert.equal(validateExternalAIEndpoint("http://localhost:11434/v1/chat").ok, true);
  assert.equal(validateExternalAIEndpoint("http://127.0.0.1:11434/v1/chat").ok, true);
  assert.equal(validateExternalAIEndpoint("http://[::1]:11434/v1/chat").ok, true);
  assert.equal(validateExternalAIEndpoint("http://api.example.com/v1/chat").ok, false);
  assert.equal(validateExternalAIEndpoint(`https://user:${TEST_SECRET}@api.example.com/v1/chat`).ok, false);
  assert.equal(validateExternalAIEndpoint(`https://api.example.com/v1/chat?api_key=${TEST_SECRET}`).ok, false);
  assert.equal(validateExternalAIEndpoint(`https://api.example.com/v1/chat?access_token=${TEST_SECRET}`).ok, false);
  assert.equal(validateExternalAIEndpoint(`https://api.example.com/v1/chat?token=${TEST_SECRET}`).ok, false);
  assert.equal(validateExternalAIEndpoint("javascript:alert(1)").ok, false);
  assert.equal(validateExternalAIEndpoint("data:text/plain,x").ok, false);
  assert.equal(validateExternalAIEndpoint("file:///tmp/model").ok, false);
  assert.equal(validateExternalAIEndpoint("not a url").ok, false);
});

test("external transport returns safe errors for HTTP and malformed responses", async () => {
  await assert.rejects(
    () => openAICompatibleChat(async () => ({ ok: false, status: 401 }), "https://example.test/v1/chat", TEST_SECRET, "m", "s", "u"),
    (err) => err.message === "External AI request failed: HTTP 401" && !err.message.includes(TEST_SECRET)
  );
  await assert.rejects(
    () => openAICompatibleChat(async () => ({ ok: true, status: 200, async json() { throw new Error("bad"); } }), "https://example.test/v1/chat", TEST_SECRET, "m", "s", "u"),
    (err) => err.message === "External AI response was not valid JSON."
  );
  await assert.rejects(
    () => openAICompatibleChat(async () => { throw new Error(`network ${TEST_SECRET}`); }, "https://example.test/v1/chat", TEST_SECRET, "m", "s", "u"),
    (err) => !err.message.includes(TEST_SECRET) && /network unavailable/.test(err.message)
  );
});

test("storage leak sweep allows sentinel only in dedicated session-secret entry", () => {
  const storage = new MemoryStorage();
  const secretStore = createSecretStore(storage);
  secretStore.setApiKey(TEST_SECRET);
  const settings = sanitizePersistentSettings({ aiApiKey: TEST_SECRET, theme: "system" });
  const data = sanitizeSecretsDeep({ ...representativeData(), diagnostics: { providerSecret: TEST_SECRET }, audit: { authorization: TEST_SECRET } });
  const payload = makeBackupPayload(settings, data, META);
  const prohibited = [JSON.stringify(settings), JSON.stringify(data), JSON.stringify(payload)];
  for (const surface of prohibited) assert.equal(surface.includes(TEST_SECRET), false);
  const occurrences = storage.entries().filter(([, value]) => value.includes(TEST_SECRET));
  assert.deepEqual(occurrences, [[SESSION_API_KEY, TEST_SECRET]]);
});

test("production bundle contains hardening integration and preserves single-file architecture", async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const html = await readFile(resolve(here, "../index.html"), "utf8");
  assert.ok(html.includes('APP_VERSION = "3.1.1";'));
  assert.equal(html.includes('version: "2.0"'), false);
  assert.equal(html.includes("settings.aiApiKey"), false);
  assert.equal(html.includes("s.aiApiKey"), false);
  assert.ok(html.includes("buildBackupPayload(s.settings, s.data)"));
  assert.ok(html.includes("SecretStore.clearApiKey();"));
  assert.ok(html.includes("validateExternalAIEndpoint"));
  assert.ok(html.includes("Do not put credentials in endpoint URL parameters."));
  assert.equal(/<script[^>]+src=/i.test(html), false);
  assert.equal(html.includes(TEST_SECRET), false);
});
