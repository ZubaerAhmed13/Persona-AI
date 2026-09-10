import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const html = await readFile(resolve(root, "index.html"));
const fixtureText = await readFile(resolve(root, "tests/fixtures/v3.1-full-backup.json"), "utf8");
const fixture = JSON.parse(fixtureText);
const SETTINGS_KEY = "persona.settings.v1";
const SESSION_KEY = "persona.secret.aiApiKey.session";
const PASSWORD = "Persona-v3.1.1-CI-roundtrip-42!";
const MOCK_KEY = "PERSONA_BROWSER_MOCK_API_KEY_7f11";
const MOCK_RESPONSE = "MOCK_EXTERNAL_OK_7f11";
const WORKFLOW_PERSON = "Browser Workflow Person 7f11";
const EXPECTED_STORES = Object.keys(fixture.data).sort();
const sleep = (ms) => new Promise((resolve2) => setTimeout(resolve2, ms));

assert.equal(EXPECTED_STORES.length, 33, "The v3.1 compatibility fixture must cover all 33 stores");

function findChrome() {
  for (const candidate of [process.env.CHROME_BIN, "google-chrome", "google-chrome-stable", "chromium", "chromium-browser"].filter(Boolean)) {
    const found = spawnSync("bash", ["-lc", `command -v ${JSON.stringify(candidate)} || true`], { encoding: "utf8" }).stdout.trim();
    if (found) return found;
  }
  throw new Error("Chrome/Chromium is required for full browser acceptance");
}

class CDP {
  constructor(url) { this.url = url; this.ws = null; this.id = 1; this.pending = new Map(); this.listeners = new Map(); }
  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve2, reject) => {
      const timer = setTimeout(() => reject(new Error("DevTools WebSocket timeout")), 10000);
      this.ws.addEventListener("open", () => { clearTimeout(timer); resolve2(); }, { once: true });
      this.ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("DevTools WebSocket failed")); }, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.id && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id); this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message || "CDP command failed")); else p.resolve(msg.result || {});
        return;
      }
      if (msg.method) for (const fn of this.listeners.get(msg.method) || []) fn(msg.params || {});
    });
  }
  send(method, params = {}) {
    const id = this.id++;
    return new Promise((resolve2, reject) => {
      this.pending.set(id, { resolve: resolve2, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(fn);
    return () => this.listeners.get(method)?.delete(fn);
  }
  async evaluate(expression) {
    const out = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description || out.exceptionDetails.text || "Browser evaluation failed");
    return out.result?.value;
  }
  close() { try { this.ws?.close(); } catch {} }
}

async function waitForDevTools(profileDir, proc) {
  const activePortFile = join(profileDir, "DevToolsActivePort");
  let lastError;
  for (let i = 0; i < 180; i++) {
    if (proc.exitCode !== null) throw new Error(`Chrome exited before DevTools was ready (${proc.exitCode})`);
    try {
      const port = Number((await readFile(activePortFile, "utf8")).split(/\r?\n/)[0]);
      if (port > 0) {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`);
        if (response.ok) {
          const target = (await response.json()).find((x) => x.type === "page" && x.webSocketDebuggerUrl);
          if (target) return target.webSocketDebuggerUrl;
        }
      }
    } catch (error) { lastError = error; }
    await sleep(100);
  }
  throw new Error(`Chrome DevTools did not become ready: ${lastError?.message || "unknown error"}`);
}

async function waitUntil(cdp, expression, label, timeoutMs = 12000) {
  const end = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < end) {
    try {
      if (await cdp.evaluate(expression)) return;
    } catch (error) { lastError = error; }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`);
}

async function navigate(cdp, url) {
  await cdp.send("Page.navigate", { url });
  await waitUntil(cdp, `location.href === ${JSON.stringify(url)} && document.readyState === 'complete'`, `navigation to ${url}`, 20000);
  await sleep(300);
}

async function reload(cdp) {
  const before = await cdp.evaluate("performance.timeOrigin");
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitUntil(cdp, `document.readyState === 'complete' && performance.timeOrigin !== ${JSON.stringify(before)}`, "manual reload", 20000);
  await sleep(300);
}

async function clickByText(cdp, text) {
  const ok = await cdp.evaluate(`(() => {
    const wanted = ${JSON.stringify(text.toLowerCase())};
    const el = Array.from(document.querySelectorAll("button,a,[role='button']"))
      .find((x) => (x.textContent || "").trim().toLowerCase() === wanted);
    if (!el) return false;
    el.click();
    return true;
  })()`);
  assert.equal(ok, true, `Control not found: ${text}`);
}

async function clickModalByText(cdp, text) {
  const ok = await cdp.evaluate(`(() => {
    const wanted = ${JSON.stringify(text.toLowerCase())};
    const root = document.querySelector('#modalRoot');
    if (!root) return false;
    const el = Array.from(root.querySelectorAll("button,a,[role='button']"))
      .find((x) => (x.textContent || "").trim().toLowerCase() === wanted);
    if (!el) return false;
    el.click();
    return true;
  })()`);
  assert.equal(ok, true, `Modal control not found: ${text}`);
}

async function clickByTextAndWaitForProductReload(cdp, text) {
  const before = await cdp.evaluate("performance.timeOrigin");
  await clickByText(cdp, text);
  try {
    await waitUntil(cdp, `document.readyState === 'complete' && performance.timeOrigin !== ${JSON.stringify(before)}`, `${text} production reload`, 30000);
  } catch (error) {
    let diag = {};
    try {
      diag = await cdp.evaluate(`({ready:document.readyState, origin:performance.timeOrigin, modal:document.querySelector('#modalRoot')?.innerText||'', toasts:document.querySelector('#toastRoot')?.innerText||''})`);
    } catch {}
    throw new Error(`${error.message}; diagnostics=${JSON.stringify(diag)}`);
  }
  await sleep(500);
}

async function openView(cdp, view, readySelector = ".page-title") {
  const selector = `[data-view="${view}"]`;
  const ok = await cdp.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.click();
    return true;
  })()`);
  assert.equal(ok, true, `${view} navigation control not found`);
  await waitUntil(cdp, `!!document.querySelector(${JSON.stringify(readySelector)})`, `${view} view controls`);
}
const openData = (cdp) => openView(cdp, "data", "#importFile");
const openSettings = (cdp) => openView(cdp, "settings", "#aiProvider");

async function bootstrapReturningUser(cdp) {
  await cdp.evaluate(`(() => {
    const current = JSON.parse(localStorage.getItem(${JSON.stringify(SETTINGS_KEY)}) || "{}");
    localStorage.setItem(${JSON.stringify(SETTINGS_KEY)}, JSON.stringify({ ...current, onboardingDone: true, aiProvider: "local", aiEnabled: true }));
    return true;
  })()`);
  await reload(cdp);
}

async function installDownloadCapture(cdp) {
  await cdp.evaluate(`(() => {
    window.__personaCapturedDownloads = [];
    if (!window.__personaCaptureInstalled) {
      const original = URL.createObjectURL.bind(URL);
      URL.createObjectURL = function(blob) {
        Promise.resolve(blob.text()).then((text) => window.__personaCapturedDownloads.push({ text, type: blob.type || "" }));
        return original(blob);
      };
      window.__personaCaptureInstalled = true;
    }
    return true;
  })()`);
}

async function waitDownload(cdp, before = 0) {
  await waitUntil(cdp, `Array.isArray(window.__personaCapturedDownloads) && window.__personaCapturedDownloads.length > ${before}`, "production download", 15000);
  return cdp.evaluate(`window.__personaCapturedDownloads.at(-1).text`);
}

async function attachJson(cdp, selector, filename, text) {
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

async function importNormal(cdp, text) {
  await openData(cdp);
  await attachJson(cdp, "#importFile", "persona-v31.json", text);
  await waitUntil(cdp, `Array.from(document.querySelectorAll("button")).some(b => (b.textContent || "").includes("Create safety backup & Import"))`, "normal import preview");
  await clickByTextAndWaitForProductReload(cdp, "Create safety backup & Import");
}

async function resetUi(cdp) {
  await openData(cdp);
  const ok = await cdp.evaluate(`(() => {
    const el = document.querySelector('[data-action="resetAll"]');
    if (!el) return false;
    el.click();
    return true;
  })()`);
  assert.equal(ok, true, "Delete All Data action unavailable");
  await waitUntil(cdp, `Array.from(document.querySelectorAll("button")).some(b => /^Delete everything$/i.test((b.textContent || "").trim()))`, "reset confirmation");
  await clickByTextAndWaitForProductReload(cdp, "Delete everything");
}

async function snapshot(cdp) {
  return cdp.evaluate(`(async () => {
    const db = await new Promise((resolve2, reject) => {
      const r = indexedDB.open("persona-ai");
      r.onsuccess = () => resolve2(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      const out = {};
      for (const store of Array.from(db.objectStoreNames)) {
        out[store] = await new Promise((resolve2, reject) => {
          const r = db.transaction(store, "readonly").objectStore(store).getAll();
          r.onsuccess = () => resolve2(r.result || []);
          r.onerror = () => reject(r.error);
        });
      }
      return out;
    } finally { db.close(); }
  })()`);
}

function canonical(db) {
  const out = {};
  for (const store of Object.keys(db).sort()) {
    out[store] = [...db[store]].sort((a, b) => String(a?.id || "").localeCompare(String(b?.id || "")));
  }
  return out;
}

function assertFixture(db, label) {
  assert.deepEqual(Object.keys(db).sort(), EXPECTED_STORES, `${label}: store set mismatch`);
  for (const store of EXPECTED_STORES) {
    assert.ok(db[store].length >= 1, `${label}: ${store} is empty`);
    for (const rec of fixture.data[store]) {
      assert.ok(db[store].some((x) => x.id === rec.id), `${label}: ${rec.id} missing from ${store}; actual ids=${db[store].map(x => x.id).join(",")}`);
    }
  }
}

function assertEmpty(db, label) {
  for (const store of EXPECTED_STORES) assert.equal(db[store]?.length || 0, 0, `${label}: ${store} not cleared`);
}

async function exportNormal(cdp) {
  await openData(cdp);
  await installDownloadCapture(cdp);
  const before = await cdp.evaluate(`window.__personaCapturedDownloads.length`);
  const ok = await cdp.evaluate(`(() => {
    const el = document.querySelector('[data-action="backup"]');
    if (!el) return false;
    el.click();
    return true;
  })()`);
  assert.equal(ok, true, "JSON backup action unavailable");
  const text = await waitDownload(cdp, before);
  const data = JSON.parse(text);
  assert.equal(data.app, "PERSONA AI");
  assert.equal(data.version, "3.1.1");
  assert.equal(data.schemaVersion, 7);
  assert.equal(data.exportFormatVersion, "3.1");
  assert.deepEqual(Object.keys(data.data || {}).sort(), EXPECTED_STORES, "Normal production backup did not include all 33 stores");
  assert.equal(text.includes(MOCK_KEY), false, "Normal backup leaked session API key");
  return text;
}

async function exportEncrypted(cdp) {
  await openData(cdp);
  await installDownloadCapture(cdp);
  const before = await cdp.evaluate(`window.__personaCapturedDownloads.length`);
  const ok = await cdp.evaluate(`(() => {
    const el = document.querySelector('[data-action="encryptedBackup"]');
    if (!el) return false;
    el.click();
    return true;
  })()`);
  assert.equal(ok, true, "Encrypted backup action unavailable");
  await waitUntil(cdp, `!!document.querySelector("#enc_pw") && !!document.querySelector("#enc_pw2")`, "encrypted export fields");
  await cdp.evaluate(`document.querySelector("#enc_pw").value=${JSON.stringify(PASSWORD)}; document.querySelector("#enc_pw2").value=${JSON.stringify(PASSWORD)}`);
  await clickByText(cdp, "Encrypt & Export");
  const text = await waitDownload(cdp, before);
  const data = JSON.parse(text);
  assert.equal(data.format, "persona-encrypted-v1");
  assert.ok(data.ciphertext?.length > 100, "Encrypted backup ciphertext is unexpectedly small");
  assert.equal(text.includes(MOCK_KEY), false, "Encrypted container leaked session API key");
  return text;
}

async function restoreEncrypted(cdp, text) {
  await openData(cdp);
  const ok = await cdp.evaluate(`(() => {
    const el = document.querySelector('[data-action="restoreEncrypted"]');
    if (!el) return false;
    el.click();
    return true;
  })()`);
  assert.equal(ok, true, "Encrypted restore action unavailable");
  await waitUntil(cdp, `!!document.querySelector("#dec_pw") && !!document.querySelector("#importEncryptedFile")`, "encrypted restore controls");
  await cdp.evaluate(`document.querySelector("#dec_pw").value=${JSON.stringify(PASSWORD)}`);
  await attachJson(cdp, "#importEncryptedFile", "persona-encrypted.json", text);
  await waitUntil(cdp, `Array.from(document.querySelectorAll("button")).some(b => /^Decrypt & Restore$/i.test((b.textContent || "").trim()) && !b.disabled)`, "enabled encrypted restore");
  await clickByTextAndWaitForProductReload(cdp, "Decrypt & Restore");
}

async function regressAllViews(cdp, runtimeErrors) {
  const views = await cdp.evaluate(`Array.from(new Set(Array.from(document.querySelectorAll('[data-view]')).map(e => e.getAttribute('data-view')).filter(Boolean)))`);
  assert.ok(views.length >= 30, `Only ${views.length} product routes found`);
  for (const view of views) {
    const errorsBefore = runtimeErrors.length;
    const selector = `[data-view="${view}"]`;
    const ok = await cdp.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.click();
      return true;
    })()`);
    assert.equal(ok, true, `${view}: navigation failed`);
    await sleep(100);
    const page = await cdp.evaluate(`({title:document.querySelector('.page-title')?.innerText||'', text:document.querySelector('#view')?.innerText||''})`);
    assert.ok(page.title.length > 0, `${view}: page title missing`);
    assert.ok(page.text.length > 20, `${view}: rendered content empty`);
    assert.equal(runtimeErrors.length, errorsBefore, `${view}: uncaught runtime error`);
  }
}

async function runCoreCrudWorkflow(cdp) {
  await openView(cdp, "people");
  assert.equal(await cdp.evaluate(`(() => { const el=document.querySelector('[data-action="addPerson"]'); if(!el)return false; el.click(); return true; })()`), true, "Add Person action unavailable");
  await waitUntil(cdp, `!!document.querySelector('#pf_name')`, "person form");
  await cdp.evaluate(`(() => { document.querySelector('#pf_name').value=${JSON.stringify(WORKFLOW_PERSON)}; const rel=document.querySelector('#pf_rel'); if(rel)rel.value='Friend'; return true; })()`);
  await clickModalByText(cdp, "Add person");
  await waitUntil(cdp, `(document.querySelector('#view')?.innerText||'').includes(${JSON.stringify(WORKFLOW_PERSON)})`, "created person rendered");
  const db = await snapshot(cdp);
  assert.ok(db.people.some((p) => p.name === WORKFLOW_PERSON), "Core CRUD workflow did not persist the created person");

  const search = await cdp.evaluate(`(() => {
    const input=document.querySelector('#globalSearchInput');
    if(!input)return false;
    input.value=${JSON.stringify(WORKFLOW_PERSON)};
    input.dispatchEvent(new Event('input',{bubbles:true}));
    return true;
  })()`);
  assert.equal(search, true, "Global search input unavailable");
  await waitUntil(cdp, `(document.querySelector('#searchResults')?.innerText||'').includes(${JSON.stringify(WORKFLOW_PERSON)})`, "global search result");
  await cdp.evaluate(`document.querySelector('#globalSearchInput').value=''; document.querySelector('#globalSearchInput').dispatchEvent(new Event('input',{bubbles:true}))`);
}

async function testLocalAnalysis(cdp, apiRequests, requestUrls) {
  await openSettings(cdp);
  await cdp.evaluate(`(() => {
    const p=document.querySelector('#aiProvider');
    p.value='local';
    p.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`);
  const apiBefore = apiRequests.length;
  const urlBefore = requestUrls.length;
  await openView(cdp, "decisions");
  assert.equal(await cdp.evaluate(`(() => { const el=document.querySelector('[data-action="addDecision"]'); if(!el)return false; el.click(); return true; })()`), true, "Decision action unavailable");
  await waitUntil(cdp, `!!document.querySelector('#dc_brief') && !!document.querySelector('#dc_person')`, "decision analysis modal");
  await cdp.evaluate(`document.querySelector('#dc_person').value='v31-person'; document.querySelector('#dc_situation').value='Project assistance'; document.querySelector('#dc_brief').click()`);
  await waitUntil(cdp, `(document.querySelector('#dc_briefOut')?.innerText || '').includes('WHAT THE DATA SAYS')`, "actual local decision analysis output");
  assert.equal(apiRequests.length, apiBefore, "Local analysis called mocked external-AI endpoint");
  const external = requestUrls.slice(urlBefore).filter((url) => {
    try {
      const u = new URL(url);
      return !["127.0.0.1", "localhost"].includes(u.hostname) && u.protocol !== "file:";
    } catch { return true; }
  });
  assert.deepEqual(external, [], `Local analysis made external request(s): ${external.join(", ")}`);
  await clickByText(cdp, "Cancel");
}

async function testExternalMock(cdp, hostedBase, apiRequests, consoleMessages) {
  await openSettings(cdp);
  const endpoint = hostedBase + "/v1/chat/completions";
  assert.equal(await cdp.evaluate(`(() => {
    const p=document.querySelector('#aiProvider');
    const e=document.querySelector('#aiEndpoint');
    const k=document.querySelector('#aiApiKey');
    if(!p||!e||!k)return false;
    p.value='api'; p.dispatchEvent(new Event('change',{bubbles:true}));
    e.value=${JSON.stringify(endpoint)}; e.dispatchEvent(new Event('change',{bubbles:true}));
    k.value=${JSON.stringify(MOCK_KEY)}; k.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`), true, "External provider UI configuration failed");
  const secretState = await cdp.evaluate(`({session:sessionStorage.getItem(${JSON.stringify(SESSION_KEY)}),persisted:localStorage.getItem(${JSON.stringify(SETTINGS_KEY)})||'',status:document.querySelector('#aiKeyStatus')?.innerText||''})`);
  assert.equal(secretState.session, MOCK_KEY, "Mock API key was not stored in session-only storage");
  assert.equal(secretState.persisted.includes(MOCK_KEY), false, "Mock API key leaked to persistent settings");
  assert.match(secretState.status, /configured/i, "Session key status was not visible");

  const before = apiRequests.length;
  assert.equal(await cdp.evaluate(`(() => { const el=document.querySelector('#aiBtn'); if(!el)return false; el.click(); return true; })()`), true, "AI Insights button unavailable");
  await waitUntil(cdp, `!!document.querySelector('#qText') && !!document.querySelector('#qAsk')`, "Ask PERSONA AI modal");
  await cdp.evaluate(`document.querySelector('#qPerson').value='v31-person'; document.querySelector('#qText').value='What does the evidence say about follow-through?'; document.querySelector('#qAsk').click()`);
  await waitUntil(cdp, `(document.querySelector('#qResult')?.innerText || '').includes(${JSON.stringify(MOCK_RESPONSE)})`, "mock external AI response", 15000);

  assert.equal(apiRequests.length, before + 1, "Expected exactly one mocked provider request");
  const req = apiRequests.at(-1);
  assert.equal(req.method, "POST");
  assert.equal(req.authorization, `Bearer ${MOCK_KEY}`);
  assert.equal(req.url.includes(MOCK_KEY), false, "API key appeared in provider URL");
  const body = JSON.parse(req.body || "{}");
  assert.ok(Array.isArray(body.messages) && body.messages.length >= 2, "External provider request did not contain chat messages");
  assert.equal(consoleMessages.some((x) => x.includes(MOCK_KEY)), false, "API key leaked to console");
  await cdp.evaluate(`document.querySelector('[data-close]')?.click()`);
}

const chrome = findChrome();
const profileDir = await mkdtemp(join(tmpdir(), "persona-full-acceptance-"));
const apiRequests = [];
const runtimeErrors = [];
const requestUrls = [];
const consoleMessages = [];
let server, cdp, chromeProcess, stderr = "";

try {
  server = createServer((req, res) => {
    if (req.url === "/" || req.url === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(html);
      return;
    }
    if (req.url === "/favicon.ico") { res.writeHead(204); res.end(); return; }
    if (req.url === "/v1/chat/completions" && req.method === "POST") {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => body += chunk);
      req.on("end", () => {
        apiRequests.push({ url: req.url, method: req.method, authorization: req.headers.authorization || "", body });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content: MOCK_RESPONSE } }] }));
      });
      return;
    }
    res.writeHead(404);
    res.end("Not found");
  });
  await new Promise((resolve2) => server.listen(0, "127.0.0.1", resolve2));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const hostedBase = `http://127.0.0.1:${address.port}`;

  chromeProcess = spawn(chrome, [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--remote-debugging-port=0", `--user-data-dir=${profileDir}`, "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] });
  chromeProcess.stderr.on("data", (chunk) => stderr += String(chunk));

  cdp = new CDP(await waitForDevTools(profileDir, chromeProcess));
  await cdp.connect();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
  await cdp.send("Log.enable");
  cdp.on("Runtime.exceptionThrown", (params) => runtimeErrors.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || "Uncaught exception"));
  cdp.on("Network.requestWillBeSent", (params) => requestUrls.push(params.request?.url || ""));
  cdp.on("Runtime.consoleAPICalled", (params) => consoleMessages.push((params.args || []).map((x) => String(x.value ?? x.description ?? "")).join(" ")));
  cdp.on("Log.entryAdded", (params) => {
    const e = params.entry || {};
    if (e.level === "error" && !/favicon\.ico/i.test(e.text || "")) runtimeErrors.push(e.text || "Browser log error");
  });

  await navigate(cdp, hostedBase + "/index.html");
  await bootstrapReturningUser(cdp);
  await installDownloadCapture(cdp);
  await importNormal(cdp, fixtureText);
  assertFixture(await snapshot(cdp), "v3.1 compatibility import");

  await regressAllViews(cdp, runtimeErrors);
  await runCoreCrudWorkflow(cdp);
  await testLocalAnalysis(cdp, apiRequests, requestUrls);

  const normalBefore = canonical(await snapshot(cdp));
  const normalText = await exportNormal(cdp);
  await resetUi(cdp);
  assertEmpty(await snapshot(cdp), "normal round-trip reset");
  await bootstrapReturningUser(cdp);
  await installDownloadCapture(cdp);
  await importNormal(cdp, normalText);
  assert.deepEqual(canonical(await snapshot(cdp)), normalBefore, "Full backup -> reset -> restore changed the database");

  await testExternalMock(cdp, hostedBase, apiRequests, consoleMessages);
  const encryptedBefore = canonical(await snapshot(cdp));
  const encryptedText = await exportEncrypted(cdp);
  await resetUi(cdp);
  assertEmpty(await snapshot(cdp), "encrypted round-trip reset");
  assert.equal(await cdp.evaluate(`sessionStorage.getItem(${JSON.stringify(SESSION_KEY)})`), null, "Reset did not clear API key");
  await bootstrapReturningUser(cdp);
  await restoreEncrypted(cdp, encryptedText);
  assert.deepEqual(canonical(await snapshot(cdp)), encryptedBefore, "Encrypted backup -> reset -> restore changed the database");
  assert.equal(await cdp.evaluate(`sessionStorage.getItem(${JSON.stringify(SESSION_KEY)})`), null, "Encrypted restore restored API key");

  assert.deepEqual(runtimeErrors, [], `Runtime errors: ${runtimeErrors.join(" | ")}`);
  assert.equal(consoleMessages.some((x) => x.includes(MOCK_KEY)), false, "API key leaked to console");
  console.log(`full-browser-acceptance: PASS (${EXPECTED_STORES.length} v3.1 stores; all product routes; core CRUD/search workflow; actual local analysis isolation; JSON backup/reset/restore; browser mocked external AI; encrypted backup/reset/restore)`);
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
