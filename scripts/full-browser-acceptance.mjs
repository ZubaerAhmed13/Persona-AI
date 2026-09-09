import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const indexPath = resolve(root, "index.html");
const fixturePath = resolve(root, "tests/fixtures/v3.1-full-backup.json");
const html = await readFile(indexPath);
const fixtureText = await readFile(fixturePath, "utf8");
const fixture = JSON.parse(fixtureText);
const SETTINGS_KEY = "persona.settings.v1";
const SESSION_KEY = "persona.secret.aiApiKey.session";
const ENCRYPTION_PASSWORD = "Persona-v3.1.1-CI-roundtrip-42!";
const MOCK_KEY = "PERSONA_BROWSER_MOCK_API_KEY_7f11";
const MOCK_RESPONSE = "MOCK_EXTERNAL_OK_7f11";
const EXPECTED_STORES = Object.keys(fixture.data).sort();

function findChrome() {
  const candidates = [process.env.CHROME_BIN, "google-chrome", "google-chrome-stable", "chromium", "chromium-browser"].filter(Boolean);
  for (const candidate of candidates) {
    const found = spawnSync("bash", ["-lc", `command -v ${JSON.stringify(candidate)} || true`], { encoding: "utf8" }).stdout.trim();
    if (found) return found;
  }
  throw new Error("A Chromium/Chrome executable is required for full browser acceptance.");
}

const sleep = (ms) => new Promise((resolve2) => setTimeout(resolve2, ms));

class CDP {
  constructor(url) { this.url = url; this.ws = null; this.nextId = 1; this.pending = new Map(); this.listeners = new Map(); }
  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve2, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out connecting to Chrome DevTools")), 10000);
      this.ws.addEventListener("open", () => { clearTimeout(timer); resolve2(); }, { once: true });
      this.ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Chrome DevTools WebSocket failed")); }, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message || "CDP command failed"));
        else pending.resolve(message.result || {});
        return;
      }
      if (message.method) for (const listener of this.listeners.get(message.method) || []) listener(message.params || {});
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve2, reject) => {
      this.pending.set(id, { resolve: resolve2, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, listener) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(listener);
    return () => this.listeners.get(method)?.delete(listener);
  }
  waitFor(method, timeoutMs = 15000) {
    return new Promise((resolve2, reject) => {
      const off = this.on(method, (params) => { clearTimeout(timer); off(); resolve2(params); });
      const timer = setTimeout(() => { off(); reject(new Error(`Timed out waiting for ${method}`)); }, timeoutMs);
    });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Browser evaluation failed");
    return result.result?.value;
  }
  close() { try { this.ws?.close(); } catch {} }
}

async function waitForDevTools(profileDir, chromeProcess) {
  const activePortFile = join(profileDir, "DevToolsActivePort");
  let lastError;
  for (let i = 0; i < 150; i++) {
    if (chromeProcess.exitCode !== null) throw new Error(`Chrome exited before DevTools became ready (exit ${chromeProcess.exitCode})`);
    try {
      const active = await readFile(activePortFile, "utf8");
      const port = Number(active.split(/\r?\n/)[0]);
      if (Number.isInteger(port) && port > 0) {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`);
        if (response.ok) {
          const targets = await response.json();
          const target = targets.find((x) => x.type === "page" && x.webSocketDebuggerUrl);
          if (target) return target.webSocketDebuggerUrl;
        }
      }
    } catch (error) { lastError = error; }
    await sleep(100);
  }
  throw new Error(`Chrome DevTools did not become ready: ${lastError?.message || "unknown error"}`);
}

async function navigate(cdp, url) {
  const loaded = cdp.waitFor("Page.loadEventFired");
  await cdp.send("Page.navigate", { url });
  await loaded;
  await sleep(500);
}

async function waitUntil(cdp, expression, label, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await cdp.evaluate(expression)) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function clickByText(cdp, text) {
  const clicked = await cdp.evaluate(`(() => {
    const target = Array.from(document.querySelectorAll("button,a,[role='button']"))
      .find((el) => (el.textContent || "").trim().toLowerCase() === ${JSON.stringify(text.toLowerCase())});
    if (!target) return false;
    target.click();
    return true;
  })()`);
  assert.equal(clicked, true, `Control not found: ${text}`);
}

async function openSettings(cdp) {
  const opened = await cdp.evaluate(`(() => {
    const el = document.querySelector('[data-view="settings"]');
    if (!el) return false;
    el.click();
    return true;
  })()`);
  assert.equal(opened, true, "Settings navigation is unavailable");
  await waitUntil(cdp, `!!document.querySelector("#importFile")`, "Settings data controls");
}

async function installDownloadCapture(cdp) {
  await cdp.evaluate(`(() => {
    window.__personaCapturedDownloads = [];
    if (!window.__personaCaptureInstalled) {
      const original = URL.createObjectURL.bind(URL);
      URL.createObjectURL = function(blob) {
        Promise.resolve(blob.text()).then((text) => {
          window.__personaCapturedDownloads.push({ text, type: blob.type || "", at: Date.now() });
        });
        return original(blob);
      };
      window.__personaCaptureInstalled = true;
    }
    return true;
  })()`);
}

async function waitForCapturedDownload(cdp, previousCount = 0) {
  await waitUntil(cdp, `Array.isArray(window.__personaCapturedDownloads) && window.__personaCapturedDownloads.length > ${previousCount}`, "captured production download");
  return cdp.evaluate(`window.__personaCapturedDownloads[window.__personaCapturedDownloads.length - 1].text`);
}

async function attachTextFile(cdp, selector, filename, text) {
  const ok = await cdp.evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) return false;
    const dt = new DataTransfer();
    dt.items.add(new File([${JSON.stringify(text)}], ${JSON.stringify(filename)}, { type: "application/json" }));
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  assert.equal(ok, true, `File input unavailable: ${selector}`);
}

async function importNormalBackup(cdp, text, { expectReload = true } = {}) {
  await openSettings(cdp);
  await attachTextFile(cdp, "#importFile", "persona-roundtrip.json", text);
  await waitUntil(cdp, `Array.from(document.querySelectorAll("button")).some(b => (b.textContent || "").includes("Create safety backup & Import"))`, "normal import preview");
  const loaded = expectReload ? cdp.waitFor("Page.loadEventFired", 15000) : null;
  await clickByText(cdp, "Create safety backup & Import");
  if (loaded) await loaded;
  await sleep(700);
}

async function resetThroughProductionUi(cdp) {
  await openSettings(cdp);
  const clicked = await cdp.evaluate(`(() => {
    const el = document.querySelector('[data-action="resetAll"]');
    if (!el) return false;
    el.click();
    return true;
  })()`);
  assert.equal(clicked, true, "Delete All Data action is unavailable");
  await waitUntil(cdp, `Array.from(document.querySelectorAll("button")).some(b => /^Delete everything$/i.test((b.textContent || "").trim()))`, "reset confirmation");
  const loaded = cdp.waitFor("Page.loadEventFired", 15000);
  await clickByText(cdp, "Delete everything");
  await loaded;
  await sleep(700);
}

async function databaseSnapshot(cdp) {
  return cdp.evaluate(`(async () => {
    const db = await new Promise((resolve2, reject) => {
      const request = indexedDB.open("persona-ai");
      request.onsuccess = () => resolve2(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
    });
    try {
      const out = {};
      for (const store of Array.from(db.objectStoreNames)) {
        out[store] = await new Promise((resolve2, reject) => {
          const tx = db.transaction(store, "readonly");
          const req = tx.objectStore(store).getAll();
          req.onsuccess = () => resolve2(req.result || []);
          req.onerror = () => reject(req.error || new Error("IndexedDB read failed"));
        });
      }
      return out;
    } finally { db.close(); }
  })()`);
}

function canonicalSnapshot(snapshot) {
  const out = {};
  for (const store of Object.keys(snapshot).sort()) {
    out[store] = [...snapshot[store]].sort((a, b) => String(a?.id || "").localeCompare(String(b?.id || "")));
  }
  return out;
}

function assertFixturePresent(snapshot, label) {
  const stores = Object.keys(snapshot).sort();
  for (const store of EXPECTED_STORES) {
    assert.ok(stores.includes(store), `${label}: missing IndexedDB store ${store}`);
    assert.ok(snapshot[store].length >= 1, `${label}: v3.1 fixture record missing from ${store}`);
    const expectedIds = new Set(fixture.data[store].map((r) => r.id));
    for (const id of expectedIds) assert.ok(snapshot[store].some((r) => r.id === id), `${label}: fixture id ${id} missing from ${store}`);
  }
}

function assertDatabaseEmpty(snapshot, label) {
  for (const store of EXPECTED_STORES) assert.equal(snapshot[store]?.length || 0, 0, `${label}: ${store} was not cleared by reset`);
}

async function exportNormalBackup(cdp) {
  await openSettings(cdp);
  await installDownloadCapture(cdp);
  const before = await cdp.evaluate(`window.__personaCapturedDownloads.length`);
  const clicked = await cdp.evaluate(`(() => { const el = document.querySelector('[data-action="backup"]'); if (!el) return false; el.click(); return true; })()`);
  assert.equal(clicked, true, "Production JSON backup action unavailable");
  const text = await waitForCapturedDownload(cdp, before);
  const parsed = JSON.parse(text);
  assert.equal(parsed.appVersion, "3.1.1", "Normal production backup appVersion is not canonical");
  assert.equal(parsed.schemaVersion, 7, "Normal production backup schemaVersion changed");
  assert.equal(parsed.exportFormatVersion, "3.1", "Normal production backup exportFormatVersion changed");
  return text;
}

async function exportEncryptedBackup(cdp) {
  await openSettings(cdp);
  await installDownloadCapture(cdp);
  const before = await cdp.evaluate(`window.__personaCapturedDownloads.length`);
  const opened = await cdp.evaluate(`(() => { const el = document.querySelector('[data-action="encryptedBackup"]'); if (!el) return false; el.click(); return true; })()`);
  assert.equal(opened, true, "Encrypted backup action unavailable");
  await waitUntil(cdp, `!!document.querySelector("#enc_pw") && !!document.querySelector("#enc_pw2")`, "encrypted backup password fields");
  await cdp.evaluate(`(() => {
    document.querySelector("#enc_pw").value = ${JSON.stringify(ENCRYPTION_PASSWORD)};
    document.querySelector("#enc_pw2").value = ${JSON.stringify(ENCRYPTION_PASSWORD)};
    return true;
  })()`);
  await clickByText(cdp, "Encrypt & Export");
  const text = await waitForCapturedDownload(cdp, before);
  const parsed = JSON.parse(text);
  assert.equal(parsed.format, "persona-encrypted-v1", "Encrypted production backup format changed");
  assert.ok(Array.isArray(parsed.ciphertext) && parsed.ciphertext.length > 100, "Encrypted production backup ciphertext missing");
  assert.equal(text.includes(MOCK_KEY), false, "Session API key leaked into encrypted backup JSON");
  return text;
}

async function restoreEncryptedBackup(cdp, encryptedText) {
  await openSettings(cdp);
  const opened = await cdp.evaluate(`(() => { const el = document.querySelector('[data-action="restoreEncrypted"]'); if (!el) return false; el.click(); return true; })()`);
  assert.equal(opened, true, "Restore Encrypted Backup action unavailable");
  await waitUntil(cdp, `!!document.querySelector("#dec_pw")`, "encrypted restore password field");
  await cdp.evaluate(`document.querySelector("#dec_pw").value = ${JSON.stringify(ENCRYPTION_PASSWORD)}`);
  await attachTextFile(cdp, "#importEncryptedFile", "persona-ai-encrypted.json", encryptedText);
  await waitUntil(cdp, `Array.from(document.querySelectorAll("button")).some(b => /^Decrypt & Restore$/i.test((b.textContent || "").trim()) && !b.disabled)`, "enabled encrypted restore action");
  const loaded = cdp.waitFor("Page.loadEventFired", 15000);
  await clickByText(cdp, "Decrypt & Restore");
  await loaded;
  await sleep(700);
}

async function productWorkflowRegression(cdp, runtimeErrors) {
  const views = await cdp.evaluate(`Array.from(new Set(Array.from(document.querySelectorAll('[data-view]')).map(el => el.getAttribute('data-view')).filter(Boolean)))`);
  assert.ok(views.length >= 20, `Expected broad product navigation coverage, found only ${views.length} routes`);
  for (const view of views) {
    const beforeErrors = runtimeErrors.length;
    const result = await cdp.evaluate(`(() => {
      const el = document.querySelector('[data-view=${JSON.stringify(view)}]');
      if (!el) return { clicked: false };
      el.click();
      const content = document.querySelector('.content');
      return { clicked: true, text: content ? content.innerText : '', title: document.querySelector('.page-title')?.innerText || '' };
    })()`);
    assert.equal(result.clicked, true, `Could not navigate to ${view}`);
    await sleep(75);
    const rendered = await cdp.evaluate(`(() => { const c = document.querySelector('.content'); return { text: c ? c.innerText : '', title: document.querySelector('.page-title')?.innerText || '' }; })()`);
    assert.ok(rendered.text.length > 20, `${view}: rendered content is unexpectedly empty`);
    assert.equal(/\bundefined\b/.test(rendered.title), false, `${view}: invalid page title`);
    assert.equal(runtimeErrors.length, beforeErrors, `${view}: uncaught runtime error during navigation`);
  }
}

async function actualLocalAnalysisNetworkTest(cdp, apiRequests, allRequestUrls) {
  await openSettings(cdp);
  await cdp.evaluate(`(() => {
    const provider = document.querySelector("#aiProvider");
    provider.value = "local";
    provider.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  const beforeApi = apiRequests.length;
  const beforeExternal = allRequestUrls.length;
  await cdp.evaluate(`document.querySelector('[data-view="decisions"]').click()`);
  await sleep(150);
  const opened = await cdp.evaluate(`(() => { const el = document.querySelector('[data-action="addDecision"]'); if (!el) return false; el.click(); return true; })()`);
  assert.equal(opened, true, "Decision workflow action unavailable");
  await waitUntil(cdp, `!!document.querySelector("#dc_brief") && !!document.querySelector("#dc_person")`, "Decision analysis modal");
  await cdp.evaluate(`(() => {
    const person = document.querySelector("#dc_person");
    person.value = "v31-person";
    person.dispatchEvent(new Event("change", { bubbles: true }));
    const situation = document.querySelector("#dc_situation");
    if (situation) situation.value = situation.options[0]?.value || "assistance";
    document.querySelector("#dc_brief").click();
    return true;
  })()`);
  await waitUntil(cdp, `(document.querySelector("#dc_briefOut")?.innerText || "").length > 20`, "local decision analysis output");
  assert.equal(apiRequests.length, beforeApi, "Actual local analysis unexpectedly invoked the external-AI endpoint");
  const newUrls = allRequestUrls.slice(beforeExternal).filter((url) => {
    try { const u = new URL(url); return u.hostname !== "127.0.0.1" && u.hostname !== "localhost" && u.protocol !== "file:"; } catch { return true; }
  });
  assert.deepEqual(newUrls, [], "Actual local analysis made an external network request");
  await clickByText(cdp, "Cancel");
}

async function browserMockedExternalAiTest(cdp, hostedBase, apiRequests, consoleMessages) {
  await openSettings(cdp);
  const configured = await cdp.evaluate(`(() => {
    const provider = document.querySelector("#aiProvider");
    const endpoint = document.querySelector("#aiEndpoint");
    const key = document.querySelector("#aiApiKey");
    if (!provider || !endpoint || !key) return false;
    provider.value = "api";
    provider.dispatchEvent(new Event("change", { bubbles: true }));
    endpoint.value = ${JSON.stringify("__ENDPOINT__")}.replace("__ENDPOINT__", ${JSON.stringify(hostedBase + "/v1/chat/completions")});
    endpoint.dispatchEvent(new Event("change", { bubbles: true }));
    key.value = ${JSON.stringify(MOCK_KEY)};
    key.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  assert.equal(configured, true, "Could not configure mocked external provider through Settings UI");
  const sessionState = await cdp.evaluate(`({ session: sessionStorage.getItem(${JSON.stringify(SESSION_KEY)}), persisted: localStorage.getItem(${JSON.stringify(SETTINGS_KEY)}) || "" })`);
  assert.equal(sessionState.session, MOCK_KEY, "External provider key was not held in session SecretStore");
  assert.equal(sessionState.persisted.includes(MOCK_KEY), false, "External provider key persisted to settings");

  const before = apiRequests.length;
  await cdp.evaluate(`document.querySelector('[data-view="dashboard"]').click()`);
  await waitUntil(cdp, `!!document.querySelector("#qaInput")`, "Ask the System input");
  await cdp.evaluate(`(() => {
    const input = document.querySelector("#qaInput");
    input.value = "What does the recorded evidence say about follow-through?";
    document.querySelector('[data-action="answerQuestion"]').click();
    return true;
  })()`);
  await waitUntil(cdp, `(document.querySelector("#qaOut")?.innerText || "").includes(${JSON.stringify(MOCK_RESPONSE)})`, "mocked external-AI response", 12000);
  assert.equal(apiRequests.length, before + 1, "External browser operation did not make exactly one provider request");
  const req = apiRequests.at(-1);
  assert.equal(req.method, "POST", "External provider request is not POST");
  assert.equal(req.authorization, `Bearer ${MOCK_KEY}`, "External provider Authorization header is incorrect");
  assert.equal(req.url.includes(MOCK_KEY), false, "External API key leaked into provider URL");
  const body = JSON.parse(req.body || "{}");
  assert.ok(Array.isArray(body.messages) && body.messages.length >= 2, "External provider request body is missing chat messages");
  assert.equal(consoleMessages.some((text) => text.includes(MOCK_KEY)), false, "External API key leaked to browser console");
}

const chrome = findChrome();
const profileDir = await mkdtemp(join(tmpdir(), "persona-full-acceptance-"));
const apiRequests = [];
let server;
let cdp;
let stderr = "";
let chromeProcess;
const runtimeErrors = [];
const allRequestUrls = [];
const consoleMessages = [];

try {
  server = createServer((req, res) => {
    if (req.url === "/" || req.url === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(html);
      return;
    }
    if (req.url === "/favicon.ico") {
      res.writeHead(204, { "cache-control": "no-store" });
      res.end();
      return;
    }
    if (req.url === "/v1/chat/completions" && req.method === "POST") {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        apiRequests.push({ url: req.url, method: req.method, authorization: req.headers.authorization || "", body });
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify({ choices: [{ message: { content: MOCK_RESPONSE } }] }));
      });
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  });
  await new Promise((resolve2) => server.listen(0, "127.0.0.1", resolve2));
  const address = server.address();
  assert.ok(address && typeof address === "object", "Acceptance HTTP server failed to bind");
  const hostedBase = `http://127.0.0.1:${address.port}`;

  chromeProcess = spawn(chrome, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] });
  chromeProcess.stderr.on("data", (chunk) => { stderr += String(chunk); });

  const wsUrl = await waitForDevTools(profileDir, chromeProcess);
  cdp = new CDP(wsUrl);
  await cdp.connect();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
  await cdp.send("Log.enable");
  cdp.on("Runtime.exceptionThrown", (params) => runtimeErrors.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || "Uncaught exception"));
  cdp.on("Network.requestWillBeSent", (params) => allRequestUrls.push(params.request?.url || ""));
  cdp.on("Runtime.consoleAPICalled", (params) => consoleMessages.push((params.args || []).map((x) => String(x.value ?? x.description ?? "")).join(" ")));
  cdp.on("Log.entryAdded", (params) => {
    const entry = params.entry || {};
    if (entry.level === "error" && !/favicon\.ico/i.test(entry.text || "")) runtimeErrors.push(entry.text || "Browser log error");
  });

  await navigate(cdp, hostedBase + "/index.html");

  // 1) Full v3.1 compatibility fixture through the real production import path.
  await installDownloadCapture(cdp);
  await importNormalBackup(cdp, fixtureText);
  let snapshot = await databaseSnapshot(cdp);
  assertFixturePresent(snapshot, "v3.1 compatibility import");
  assert.equal(Object.keys(snapshot).sort().join("|"), EXPECTED_STORES.join("|"), "Current IndexedDB store set differs from the full v3.1 fixture store set");

  // 2) Broad product workflow regression against fully populated v3.1 data.
  await productWorkflowRegression(cdp, runtimeErrors);

  // 3) Actual local-analysis action must remain network-isolated.
  await actualLocalAnalysisNetworkTest(cdp, apiRequests, allRequestUrls);

  // 4) Full production JSON backup -> reset -> restore round trip.
  const normalBefore = canonicalSnapshot(await databaseSnapshot(cdp));
  const normalBackupText = await exportNormalBackup(cdp);
  await resetThroughProductionUi(cdp);
  assertDatabaseEmpty(await databaseSnapshot(cdp), "normal round-trip reset");
  await installDownloadCapture(cdp);
  await importNormalBackup(cdp, normalBackupText);
  const normalAfter = canonicalSnapshot(await databaseSnapshot(cdp));
  assert.deepEqual(normalAfter, normalBefore, "Full JSON backup -> reset -> restore did not reproduce the pre-reset database");

  // 5) Browser-level mocked external-AI operation through actual Settings + Ask UI.
  await browserMockedExternalAiTest(cdp, hostedBase, apiRequests, consoleMessages);

  // 6) Actual production encrypted backup -> reset -> decrypt/restore round trip.
  const encryptedBefore = canonicalSnapshot(await databaseSnapshot(cdp));
  const encryptedBackupText = await exportEncryptedBackup(cdp);
  await resetThroughProductionUi(cdp);
  assertDatabaseEmpty(await databaseSnapshot(cdp), "encrypted round-trip reset");
  assert.equal(await cdp.evaluate(`sessionStorage.getItem(${JSON.stringify(SESSION_KEY)})`), null, "Reset failed to clear session API key before encrypted restore");
  await restoreEncryptedBackup(cdp, encryptedBackupText);
  const encryptedAfter = canonicalSnapshot(await databaseSnapshot(cdp));
  assert.deepEqual(encryptedAfter, encryptedBefore, "Encrypted backup -> reset -> restore did not reproduce the pre-reset database");
  assert.equal(await cdp.evaluate(`sessionStorage.getItem(${JSON.stringify(SESSION_KEY)})`), null, "Encrypted restore incorrectly restored an API credential");

  assert.deepEqual(runtimeErrors, [], `Browser acceptance had uncaught/runtime errors: ${runtimeErrors.join(" | ")}`);
  assert.equal(consoleMessages.some((text) => text.includes(MOCK_KEY)), false, "Mock API key appeared in browser console output");
  console.log(`full-browser-acceptance: PASS (${EXPECTED_STORES.length} v3.1 stores, all product routes, local analysis isolation, normal backup/reset/restore, mocked external AI, encrypted backup/reset/restore)`);
} finally {
  cdp?.close();
  if (chromeProcess) {
    const exited = chromeProcess.exitCode === null ? once(chromeProcess, "exit").catch(() => []) : Promise.resolve([]);
    if (chromeProcess.exitCode === null) chromeProcess.kill("SIGTERM");
    await Promise.race([exited, sleep(2000)]);
    if (chromeProcess.exitCode === null) {
      chromeProcess.kill("SIGKILL");
      await Promise.race([exited, sleep(2000)]);
    }
  }
  if (server) {
    server.closeAllConnections?.();
    await new Promise((resolve2) => server.close(() => resolve2()));
  }
  await sleep(250);
  await rm(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
}

if (stderr && /(?:SyntaxError|ReferenceError|Uncaught TypeError)/i.test(stderr)) {
  throw new Error(`Chrome stderr contained a JavaScript failure: ${stderr.slice(-4000)}`);
}
