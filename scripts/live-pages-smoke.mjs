import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LIVE_URL = process.env.PERSONA_LIVE_URL || "https://zubaerahmed13.github.io/Persona-AI/";
const EXPECTED_VERSION = process.env.PERSONA_EXPECTED_VERSION || "3.1.1";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findChrome() {
  const candidates = [process.env.CHROME_BIN, "google-chrome", "google-chrome-stable", "chromium", "chromium-browser"].filter(Boolean);
  for (const candidate of candidates) {
    const found = spawnSync("bash", ["-lc", `command -v ${JSON.stringify(candidate)} || true`], { encoding: "utf8" }).stdout.trim();
    if (found) return found;
  }
  throw new Error("A Chromium/Chrome executable is required for live Pages smoke verification.");
}

class CDP {
  constructor(url) { this.url = url; this.ws = null; this.id = 1; this.pending = new Map(); this.listeners = new Map(); }
  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out connecting to Chrome DevTools")), 10000);
      this.ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      this.ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Chrome DevTools WebSocket failed")); }, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.id && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message || "CDP command failed")); else p.resolve(msg.result || {});
        return;
      }
      if (msg.method) for (const fn of this.listeners.get(msg.method) || []) fn(msg.params || {});
    });
  }
  send(method, params = {}) {
    const id = this.id++;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(fn);
    return () => this.listeners.get(method)?.delete(fn);
  }
  waitFor(method, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const off = this.on(method, (params) => { clearTimeout(timer); off(); resolve(params); });
      const timer = setTimeout(() => { off(); reject(new Error(`Timed out waiting for ${method}`)); }, timeoutMs);
    });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Browser evaluation failed");
    return result.result?.value;
  }
  close() { try { this.ws?.close(); } catch {} }
}

async function waitForDevTools(profileDir, process) {
  const path = join(profileDir, "DevToolsActivePort");
  let lastError;
  for (let i = 0; i < 200; i++) {
    if (process.exitCode !== null) throw new Error(`Chrome exited before DevTools became ready (exit ${process.exitCode})`);
    try {
      const text = await readFile(path, "utf8");
      const port = Number(text.split(/\r?\n/)[0]);
      if (port > 0) {
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

const chrome = findChrome();
const profileDir = await mkdtemp(join(tmpdir(), "persona-live-pages-"));
const chromeProcess = spawn(chrome, [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--remote-debugging-port=0",
  `--user-data-dir=${profileDir}`,
  "about:blank"
], { stdio: ["ignore", "ignore", "pipe"] });

let cdp;
let stderr = "";
const runtimeErrors = [];
const failedRequests = [];
const badResponses = [];
chromeProcess.stderr.on("data", (chunk) => { stderr += String(chunk); });

try {
  const ws = await waitForDevTools(profileDir, chromeProcess);
  cdp = new CDP(ws);
  await cdp.connect();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
  await cdp.send("Log.enable");
  cdp.on("Runtime.exceptionThrown", (p) => runtimeErrors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || "Uncaught exception"));
  cdp.on("Network.loadingFailed", (p) => { if (!/favicon\.ico/i.test(p.errorText || "")) failedRequests.push(p.errorText || "request failed"); });
  cdp.on("Network.responseReceived", (p) => {
    const url = p.response?.url || "";
    const status = p.response?.status || 0;
    if (status >= 400 && !/favicon\.ico/i.test(url)) badResponses.push(`${status} ${url}`);
  });
  cdp.on("Log.entryAdded", (p) => {
    const entry = p.entry || {};
    if (entry.level === "error" && !/favicon\.ico/i.test(entry.text || "")) runtimeErrors.push(entry.text || "Browser console error");
  });

  const loaded = cdp.waitFor("Page.loadEventFired", 30000);
  await cdp.send("Page.navigate", { url: LIVE_URL });
  await loaded;
  await sleep(1500);

  const result = await cdp.evaluate(`(() => ({
    href: location.href,
    title: document.title,
    body: document.body?.innerText || "",
    versionText: document.querySelector('.version')?.innerText || "",
    settingsNav: !!document.querySelector('[data-view="settings"]'),
    peopleNav: !!document.querySelector('[data-view="people"]')
  }))()`);
  assert.match(result.title, /PERSONA AI/i, "Live Pages document title is not Persona AI");
  assert.match(result.body, /PERSONA AI/i, "Live Pages application body did not render Persona AI");
  assert.ok(result.body.length > 500, "Live Pages rendered body is unexpectedly small");
  assert.ok(result.versionText.includes(EXPECTED_VERSION) || result.body.includes(EXPECTED_VERSION), `Live Pages does not expose expected version ${EXPECTED_VERSION}`);
  assert.equal(result.settingsNav, true, "Live Pages Settings navigation is missing");
  assert.equal(result.peopleNav, true, "Live Pages People navigation is missing");
  assert.deepEqual(runtimeErrors, [], `Live Pages browser/runtime errors: ${runtimeErrors.join(" | ")}`);
  assert.deepEqual(failedRequests, [], `Live Pages network failures: ${failedRequests.join(" | ")}`);
  assert.deepEqual(badResponses, [], `Live Pages HTTP failures: ${badResponses.join(" | ")}`);
  console.log(`live-pages-smoke: PASS (${LIVE_URL}, Persona AI ${EXPECTED_VERSION}, rendered Chrome session, no runtime/network failures)`);
} finally {
  cdp?.close();
  const exited = chromeProcess.exitCode === null ? once(chromeProcess, "exit").catch(() => []) : Promise.resolve([]);
  if (chromeProcess.exitCode === null) chromeProcess.kill("SIGTERM");
  await Promise.race([exited, sleep(2000)]);
  if (chromeProcess.exitCode === null) {
    chromeProcess.kill("SIGKILL");
    await Promise.race([exited, sleep(2000)]);
  }
  await sleep(250);
  await rm(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
}

if (stderr && /(?:SyntaxError|ReferenceError|Uncaught TypeError)/i.test(stderr)) {
  throw new Error(`Chrome stderr contained a JavaScript failure: ${stderr.slice(-4000)}`);
}
