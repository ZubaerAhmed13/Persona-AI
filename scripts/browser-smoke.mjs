import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(new URL("..", import.meta.url).pathname);
const indexPath = resolve(root, "index.html");
const html = await readFile(indexPath);
const TEST_SECRET = "PERSONA_BROWSER_SECRET_DO_NOT_PERSIST_91c4";
const SESSION_KEY = "persona.secret.aiApiKey.session";
const SETTINGS_KEY = "persona.settings.v1";

function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser"
  ].filter(Boolean);
  for (const candidate of candidates) {
    const found = spawnSync("bash", ["-lc", `command -v ${JSON.stringify(candidate)} || true`], { encoding: "utf8" }).stdout.trim();
    if (found) return found;
  }
  throw new Error("A Chromium/Chrome executable is required for browser smoke verification.");
}

const sleep = (ms) => new Promise((resolve2) => setTimeout(resolve2, ms));

class CDP {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }
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
        const { resolve: resolve2, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message || "CDP command failed"));
        else resolve2(message.result || {});
        return;
      }
      if (message.method) {
        for (const listener of this.listeners.get(message.method) || []) listener(message.params || {});
      }
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
  waitFor(method, timeoutMs = 10000) {
    return new Promise((resolve2, reject) => {
      const off = this.on(method, (params) => {
        clearTimeout(timer);
        off();
        resolve2(params);
      });
      const timer = setTimeout(() => {
        off();
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
    });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    });
    if (result.exceptionDetails) {
      const text = result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Browser evaluation failed";
      throw new Error(text);
    }
    return result.result?.value;
  }
  close() {
    try { this.ws?.close(); } catch {}
  }
}

async function waitForDevTools(port) {
  const url = `http://127.0.0.1:${port}/json/list`;
  let lastError;
  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const targets = await response.json();
        const target = targets.find((x) => x.type === "page" && x.webSocketDebuggerUrl);
        if (target) return target.webSocketDebuggerUrl;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw new Error(`Chrome DevTools did not become ready: ${lastError?.message || "unknown error"}`);
}

async function navigate(cdp, url) {
  const loaded = cdp.waitFor("Page.loadEventFired", 15000);
  await cdp.send("Page.navigate", { url });
  await loaded;
  await sleep(500);
}

async function reload(cdp) {
  const loaded = cdp.waitFor("Page.loadEventFired", 15000);
  await cdp.send("Page.reload", { ignoreCache: true });
  await loaded;
  await sleep(600);
}

async function prepareApp(cdp) {
  await cdp.evaluate(`(() => {
    localStorage.setItem(${JSON.stringify(SETTINGS_KEY)}, JSON.stringify({
      onboardingDone: true,
      aiEnabled: true,
      aiProvider: "local",
      aiEndpoint: "https://should-never-be-called.invalid/v1/chat/completions",
      aiApiKey: ${JSON.stringify(TEST_SECRET)},
      theme: "system"
    }));
    try { sessionStorage.removeItem(${JSON.stringify(SESSION_KEY)}); } catch {}
    return true;
  })()`);
  await reload(cdp);
}

function externalRequestsFrom(requestUrls) {
  return requestUrls.filter((url) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "file:") return false;
      if (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") return false;
      return true;
    } catch {
      return true;
    }
  });
}

async function verifyLoadedApp(cdp, label, requestUrls, runtimeErrors) {
  const bodyText = await cdp.evaluate("document.body ? document.body.innerText : ''");
  assert.ok(typeof bodyText === "string" && bodyText.length > 500, `${label}: application body did not render`);
  assert.match(bodyText, /PERSONA/i, `${label}: Persona branding missing from rendered DOM`);

  const storageResult = await cdp.evaluate(`(() => {
    const persisted = JSON.parse(localStorage.getItem(${JSON.stringify(SETTINGS_KEY)}) || "{}");
    return {
      persistedHasApiKey: Object.prototype.hasOwnProperty.call(persisted, "aiApiKey"),
      persistentContainsSecret: (localStorage.getItem(${JSON.stringify(SETTINGS_KEY)}) || "").includes(${JSON.stringify(TEST_SECRET)}),
      sessionSecret: sessionStorage.getItem(${JSON.stringify(SESSION_KEY)}),
      sessionCount: Object.keys(sessionStorage).length
    };
  })()`);
  assert.equal(storageResult.persistedHasApiKey, false, `${label}: legacy API key remained in persistent settings`);
  assert.equal(storageResult.persistentContainsSecret, false, `${label}: API key leaked to persistent localStorage`);
  assert.equal(storageResult.sessionSecret, TEST_SECRET, `${label}: legacy key was not moved to the dedicated current-session secret entry`);

  const dbResult = await cdp.evaluate(`(async () => {
    const db = await new Promise((resolve2, reject) => {
      const request = indexedDB.open("persona-ai");
      request.onsuccess = () => resolve2(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
    });
    const stores = Array.from(db.objectStoreNames);
    db.close();
    return stores;
  })()`);
  for (const store of ["people", "interactions", "playbooks", "signals", "situations", "experiments", "relationshipGoals", "auditLog"]) {
    assert.ok(dbResult.includes(store), `${label}: required IndexedDB store missing: ${store}`);
  }

  // Local-mode startup must remain completely network-isolated before any provider UI change.
  assert.deepEqual(externalRequestsFrom(requestUrls), [], `${label}: local-mode startup made an external request`);

  const settingsOpened = await cdp.evaluate(`(() => {
    const clickable = Array.from(document.querySelectorAll("button,a,[role='button'],[data-route]"));
    const target = clickable.find((el) => /^settings$/i.test((el.textContent || "").trim())) || clickable.find((el) => /settings/i.test((el.textContent || "").trim()));
    if (!target) return false;
    target.click();
    return true;
  })()`);
  assert.equal(settingsOpened, true, `${label}: Settings navigation control not found`);
  await sleep(400);

  // Deliberately reveal the External API configuration UI. Merely selecting it must not transmit anything.
  const externalUiSelected = await cdp.evaluate(`(() => {
    const provider = document.querySelector("#aiProvider");
    if (!provider) return false;
    if (provider.value !== "api") {
      provider.value = "api";
      provider.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return true;
  })()`);
  assert.equal(externalUiSelected, true, `${label}: AI provider selector missing`);
  await sleep(500);

  const settingsUi = await cdp.evaluate(`(() => {
    const input = document.querySelector("#aiApiKey");
    const clear = document.querySelector("#clearAiApiKey");
    const apiFields = document.querySelector("#apiFields");
    const visibleText = apiFields && !apiFields.hidden ? apiFields.innerText : "";
    return {
      hasInput: !!input,
      inputType: input?.type || null,
      inputValue: input?.value || "",
      hasClear: !!clear,
      apiFieldsVisible: !!apiFields && !apiFields.hidden,
      hasSessionCopy: /browser session/i.test(visibleText),
      hasExternalCopy: /OpenAI-compatible|external/i.test(visibleText)
    };
  })()`);
  assert.equal(settingsUi.apiFieldsVisible, true, `${label}: External API fields did not become visible`);
  assert.equal(settingsUi.hasInput, true, `${label}: API-key input missing`);
  assert.equal(settingsUi.inputType, "password", `${label}: API-key input is not a password field`);
  assert.equal(settingsUi.inputValue, "", `${label}: raw session secret was rendered back into the DOM`);
  assert.equal(settingsUi.hasClear, true, `${label}: Clear API key action missing`);
  assert.equal(settingsUi.hasSessionCopy, true, `${label}: visible session-only security copy missing`);
  assert.equal(settingsUi.hasExternalCopy, true, `${label}: visible external-processing copy missing`);

  assert.deepEqual(externalRequestsFrom(requestUrls), [], `${label}: selecting External API configuration sent data before an analysis operation`);

  const cleared = await cdp.evaluate(`(() => {
    const button = document.querySelector("#clearAiApiKey");
    button?.click();
    return sessionStorage.getItem(${JSON.stringify(SESSION_KEY)});
  })()`);
  assert.equal(cleared, null, `${label}: Clear API key did not remove the session secret`);
  assert.deepEqual(runtimeErrors, [], `${label}: uncaught browser/runtime errors: ${runtimeErrors.join(" | ")}`);
}

const chrome = findChrome();
const profileDir = await mkdtemp(join(tmpdir(), "persona-chrome-"));
const port = 9222 + Math.floor(Math.random() * 500);
const chromeProcess = spawn(chrome, [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--allow-file-access-from-files",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profileDir}`,
  "about:blank"
], { stdio: ["ignore", "pipe", "pipe"] });

let stderr = "";
chromeProcess.stderr.on("data", (chunk) => { stderr += String(chunk); });
let server;
let cdp;
try {
  const wsUrl = await waitForDevTools(port);
  cdp = new CDP(wsUrl);
  await cdp.connect();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
  await cdp.send("Log.enable");

  let requestUrls = [];
  let runtimeErrors = [];
  cdp.on("Network.requestWillBeSent", (params) => requestUrls.push(params.request?.url || ""));
  cdp.on("Runtime.exceptionThrown", (params) => runtimeErrors.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || "Uncaught exception"));
  cdp.on("Log.entryAdded", (params) => {
    const entry = params.entry || {};
    if (entry.level === "error" && !/favicon\.ico/i.test(entry.text || "")) runtimeErrors.push(entry.text || "Browser log error");
  });

  // 1) Direct-file acceptance path.
  await navigate(cdp, pathToFileURL(indexPath).href);
  requestUrls = [];
  runtimeErrors = [];
  await prepareApp(cdp);
  await verifyLoadedApp(cdp, "direct-file", requestUrls, runtimeErrors);

  // 2) HTTP-hosted acceptance path, equivalent to the GitHub Pages delivery model.
  server = createServer((req, res) => {
    if (req.url === "/" || req.url === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(html);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  });
  await new Promise((resolve2) => server.listen(0, "127.0.0.1", resolve2));
  const address = server.address();
  assert.ok(address && typeof address === "object", "HTTP smoke server failed to bind");
  const hostedUrl = `http://127.0.0.1:${address.port}/index.html`;
  await navigate(cdp, hostedUrl);
  requestUrls = [];
  runtimeErrors = [];
  await prepareApp(cdp);
  await verifyLoadedApp(cdp, "http-hosted", requestUrls, runtimeErrors);

  console.log("browser-smoke: PASS (direct-file + HTTP-hosted, storage migration, IndexedDB schema, Settings security UX, local-mode startup network isolation, external-config disclosure without transmission)");
} finally {
  cdp?.close();
  if (server) await new Promise((resolve2) => server.close(resolve2));
  chromeProcess.kill("SIGTERM");
  await sleep(200);
  if (!chromeProcess.killed) chromeProcess.kill("SIGKILL");
  await rm(profileDir, { recursive: true, force: true });
}

if (stderr && /(?:SyntaxError|ReferenceError|Uncaught TypeError)/i.test(stderr)) {
  throw new Error(`Chrome stderr contained a JavaScript failure: ${stderr.slice(-4000)}`);
}
