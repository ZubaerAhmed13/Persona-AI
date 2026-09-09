// PERSONA AI v3.1.1 hardening source of truth.
// These functions are dependency-free so the build can inject the same logic into
// the self-contained production index.html without adding runtime assets.

export const SECRET_SETTING_KEYS = Object.freeze([
  "aiApiKey",
  "apiKey",
  "authorization",
  "accessToken",
  "refreshToken",
  "clientSecret",
  "providerSecret",
  "providerToken"
]);

export const SESSION_API_KEY = "persona.secret.aiApiKey.session";

export function isSecretSettingKey(key) {
  const k = String(key || "");
  if (SECRET_SETTING_KEYS.includes(k)) return true;
  const normalized = k.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return /(?:apikey|accesstoken|refreshtoken|clientsecret|providersecret|providertoken|authorization)$/.test(normalized);
}

export function sanitizePersistentSettings(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (!isSecretSettingKey(key)) out[key] = value;
  }
  return out;
}

export function sanitizeSecretsDeep(value, seen = new WeakSet()) {
  if (value == null || typeof value !== "object") return value;
  if (seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeSecretsDeep(item, seen)).filter((item) => item !== undefined);
  }
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (isSecretSettingKey(key)) continue;
    const safe = sanitizeSecretsDeep(child, seen);
    if (safe !== undefined) out[key] = safe;
  }
  return out;
}

export function createSecretStore(storageOverride) {
  let memoryApiKey = "";
  const storage = storageOverride !== undefined ? storageOverride : (() => {
    try {
      return globalThis.sessionStorage;
    } catch {
      return null;
    }
  })();

  function readSession() {
    try {
      return storage && typeof storage.getItem === "function" ? String(storage.getItem(SESSION_API_KEY) || "") : "";
    } catch {
      return "";
    }
  }

  return {
    getApiKey() {
      return readSession() || memoryApiKey;
    },
    setApiKey(value) {
      const key = String(value || "").trim();
      memoryApiKey = key;
      try {
        if (storage && typeof storage.setItem === "function" && typeof storage.removeItem === "function") {
          if (key) storage.setItem(SESSION_API_KEY, key);
          else storage.removeItem(SESSION_API_KEY);
        }
      } catch {
        // Memory-only fallback is intentional. Never fall back to localStorage.
      }
      return Boolean(key);
    },
    clearApiKey() {
      memoryApiKey = "";
      try {
        if (storage && typeof storage.removeItem === "function") storage.removeItem(SESSION_API_KEY);
      } catch {
      }
    },
    hasApiKey() {
      return Boolean(this.getApiKey());
    }
  };
}

export function migrateLegacySettings(rawSettings, secretStore) {
  const source = rawSettings && typeof rawSettings === "object" && !Array.isArray(rawSettings) ? rawSettings : {};
  const legacyKey = typeof source.aiApiKey === "string" ? source.aiApiKey.trim() : "";
  if (legacyKey && secretStore && typeof secretStore.setApiKey === "function") {
    secretStore.setApiKey(legacyKey);
  }
  const settings = sanitizePersistentSettings(source);
  return {
    settings,
    changed: Object.keys(source).some(isSecretSettingKey),
    movedLegacyCredentialToSession: Boolean(legacyKey)
  };
}

export function prepareImportedSettings(rawSettings) {
  const source = rawSettings && typeof rawSettings === "object" && !Array.isArray(rawSettings) ? rawSettings : {};
  return {
    settings: sanitizePersistentSettings(source),
    hadCredentials: Object.keys(source).some(isSecretSettingKey)
  };
}

export function makeBackupPayload(settings, data, metadata) {
  const meta = metadata && typeof metadata === "object" ? metadata : {};
  return {
    app: meta.app || "PERSONA AI",
    version: meta.version,
    schemaVersion: meta.schemaVersion,
    exportFormatVersion: meta.exportFormatVersion,
    exportedAt: meta.exportedAt || new Date().toISOString(),
    settings: sanitizePersistentSettings(settings),
    data: sanitizeSecretsDeep(data)
  };
}

export function validateExternalAIEndpoint(endpoint) {
  const raw = String(endpoint || "").trim();
  if (!raw) return { ok: false, message: "An endpoint is required to enable external AI." };
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, message: "Enter a valid external AI endpoint URL." };
  }
  const protocol = url.protocol.toLowerCase();
  if (protocol !== "https:" && protocol !== "http:") {
    return { ok: false, message: "External AI endpoints must use HTTPS. HTTP is allowed only for localhost." };
  }
  const host = url.hostname.toLowerCase();
  const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  if (protocol === "http:" && !local) {
    return { ok: false, message: "Remote external AI endpoints must use HTTPS." };
  }
  if (!url.pathname) url.pathname = "/";
  return { ok: true, url: url.toString(), local };
}

export function shouldUseExternalAI(settings) {
  return Boolean(settings && settings.aiEnabled && settings.aiProvider === "api" && String(settings.aiEndpoint || "").trim());
}

export async function openAICompatibleChat(fetchImpl, endpoint, apiKey, model, system, user) {
  const checked = validateExternalAIEndpoint(endpoint);
  if (!checked.ok) throw new Error(checked.message);
  if (typeof fetchImpl !== "function") throw new Error("External AI request failed: network API unavailable.");
  let response;
  try {
    response = await fetchImpl(checked.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: "Bearer " + apiKey } : {})
      },
      body: JSON.stringify({
        model: model || "gpt-3.5-turbo",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ],
        temperature: 0.3
      })
    });
  } catch {
    throw new Error("External AI request failed: network unavailable, blocked, or CORS denied.");
  }
  if (!response || !response.ok) {
    const status = response && Number.isFinite(response.status) ? response.status : 0;
    throw new Error(status ? "External AI request failed: HTTP " + status : "External AI request failed.");
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error("External AI response was not valid JSON.");
  }
  const content = body && body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("External AI response did not contain a usable message.");
  }
  return content;
}
