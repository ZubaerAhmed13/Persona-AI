import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  for (const candidate of [process.env.CHROME_BIN, "google-chrome", "google-chrome-stable", "chromium", "chromium-browser"].filter(Boolean)) {
    const found = spawnSync("bash", ["-lc", `command -v ${JSON.stringify(candidate)} || true`], { encoding: "utf8" }).stdout.trim();
    if (found) return found;
  }
  throw new Error("A Chromium/Chrome executable is required for browser smoke verification.");
}

class CDP {
  constructor(url) { this.url = url; this.ws = null; this.id = 1; this.pending = new Map(); this.listeners = new Map(); }
  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve2, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out connecting to Chrome DevTools")), 10000);
      this.ws.addEventListener("open", () => { clearTimeout(timer); resolve2(); }, { once: true });
      this.ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Chrome DevTools WebSocket failed")); }, { once: true });
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
    return new Promise((resolve2, reject) => { this.pending.set(id, { resolve: resolve2, reject }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(fn);
    return () => this.listeners.get(method)?.delete(fn);
  }
  waitFor(method, timeoutMs = 15000) {
    return new Promise((resolve2, reject) => {
      const off = this.on(method, (params) => { clearTimeout(timer); off(); resolve2(params); });
      const timer = setTimeout(() => { off(); reject(new Error(`Timed out waiting for ${method}`)); }, timeoutMs);
    });
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
    if (proc.exitCode !== null) throw new Error(`Chrome exited before DevTools became ready (${proc.exitCode})`);
    try {
      const port = Number((await readFile(activePortFile, "utf8")).split(/\r?\n/)[0]);
      if (port > 0) {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`);
        if (response.ok) {
          const target = (await response.json()).find((x) => x.type === "page" && x.webSocketDebuggerUrl);
          if (target) return target.webSocketDebuggerUrl;
        }
      }
    } catch (e) { lastError = e; }
    await sleep(100);
  }
  throw new Error(`Chrome DevTools did not become ready: ${lastError?.message || "unknown error"}`);
}

async function navigate(cdp, url) {
  const loaded = cdp.waitFor("Page.loadEventFired");
  await cdp.send("Page.navigate", { url }); await loaded; await sleep(500);
}
async function reload(cdp) {
  const loaded = cdp.waitFor("Page.loadEventFired");
  await cdp.send("Page.reload", { ignoreCache: true }); await loaded; await sleep(600);
}
function externalRequests(urls) {
  return urls.filter((url) => { try { const u = new URL(url); return u.protocol !== "file:" && !["127.0.0.1", "localhost"].includes(u.hostname); } catch { return true; } });
}

async function prepareApp(cdp) {
  await cdp.evaluate(`(() => {
    localStorage.setItem(${JSON.stringify(SETTINGS_KEY)}, JSON.stringify({onboardingDone:true,aiEnabled:true,aiProvider:'local',aiEndpoint:'https://should-never-be-called.invalid/v1/chat/completions',aiApiKey:${JSON.stringify(TEST_SECRET)},theme:'system'}));
    try { sessionStorage.removeItem(${JSON.stringify(SESSION_KEY)}); } catch {}
    return true;
  })()`);
  await reload(cdp);
}

async function openSettings(cdp) {
  const ok = await cdp.evaluate(`(() => { const el=document.querySelector('[data-view="settings"]'); if(!el)return false; el.click(); return true; })()`);
  assert.equal(ok, true, "Settings navigation missing");
  await sleep(300);
}

async function verifySecretMigrationAndUi(cdp, label) {
  const state = await cdp.evaluate(`(() => { const raw=localStorage.getItem(${JSON.stringify(SETTINGS_KEY)})||'{}'; const p=JSON.parse(raw); let ss=null; try{ss=sessionStorage.getItem(${JSON.stringify(SESSION_KEY)});}catch{} return {persistentHasKey:Object.prototype.hasOwnProperty.call(p,'aiApiKey'),persistentContainsSecret:raw.includes(${JSON.stringify(TEST_SECRET)}),sessionSecret:ss}; })()`);
  assert.equal(state.persistentHasKey, false, `${label}: legacy API-key field remained persistent`);
  assert.equal(state.persistentContainsSecret, false, `${label}: API key leaked to localStorage`);

  await openSettings(cdp);
  const selected = await cdp.evaluate(`(() => { const p=document.querySelector('#aiProvider'); if(!p)return false; p.value='api'; p.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
  assert.equal(selected, true, `${label}: provider selector missing`); await sleep(250);
  const ui = await cdp.evaluate(`(() => { const input=document.querySelector('#aiApiKey'), clear=document.querySelector('#clearAiApiKey'), fields=document.querySelector('#apiFields'), status=document.querySelector('#aiKeyStatus'); return {input:!!input,type:input?.type||'',value:input?.value||'',clear:!!clear,visible:!!fields&&!fields.hidden,text:fields?.innerText||'',status:status?.innerText||''}; })()`);
  assert.equal(ui.visible, true, `${label}: external API fields not visible`);
  assert.equal(ui.input, true, `${label}: key input missing`); assert.equal(ui.type, "password"); assert.equal(ui.value, "", `${label}: raw key rendered into DOM`); assert.equal(ui.clear, true);
  assert.match(ui.text, /browser session/i, `${label}: session-only disclosure missing`); assert.match(ui.text, /OpenAI-compatible|external/i, `${label}: external-processing disclosure missing`);
  if (state.sessionSecret === TEST_SECRET) {
    assert.match(ui.status, /configured/i, `${label}: configured-key status missing`);
  } else {
    assert.equal(label, "direct-file", `${label}: hosted mode must retain key in sessionStorage`);
    assert.match(ui.status, /configured/i, `${label}: direct-file memory fallback did not retain migrated key in current page`);
  }
  const cleared = await cdp.evaluate(`(() => { document.querySelector('#clearAiApiKey')?.click(); let s=null; try{s=sessionStorage.getItem(${JSON.stringify(SESSION_KEY)});}catch{} return {session:s,status:document.querySelector('#aiKeyStatus')?.innerText||''}; })()`);
  assert.equal(cleared.session, null, `${label}: Clear API key did not clear sessionStorage`); assert.match(cleared.status, /No key configured/i, `${label}: clear-key status did not update`);
}

async function verifyIndexedDbScrub(cdp, label) {
  const id = `persona-browser-secret-fixture-${label}`;
  const stores = await cdp.evaluate(`(async()=>{const db=await new Promise((resolve2,reject)=>{const r=indexedDB.open('persona-ai');r.onsuccess=()=>resolve2(r.result);r.onerror=()=>reject(r.error)});const names=Array.from(db.objectStoreNames);await new Promise((resolve2,reject)=>{const tx=db.transaction('people','readwrite');tx.objectStore('people').put({id:${JSON.stringify(id)},name:'Browser Legacy Secret Fixture',providerToken:${JSON.stringify(TEST_SECRET)},createdAt:'2026-09-09T00:00:00.000Z',updatedAt:'2026-09-09T00:00:00.000Z',schemaVersion:7});tx.oncomplete=resolve2;tx.onerror=()=>reject(tx.error)});db.close();return names})()`);
  for (const store of ["people","interactions","playbooks","signals","situations","experiments","relationshipGoals","auditLog"]) assert.ok(stores.includes(store), `${label}: missing store ${store}`);
  await reload(cdp);
  const rec = await cdp.evaluate(`(async()=>{const db=await new Promise((resolve2,reject)=>{const r=indexedDB.open('persona-ai');r.onsuccess=()=>resolve2(r.result);r.onerror=()=>reject(r.error)});const v=await new Promise((resolve2,reject)=>{const r=db.transaction('people','readonly').objectStore('people').get(${JSON.stringify(id)});r.onsuccess=()=>resolve2(r.result||null);r.onerror=()=>reject(r.error)});db.close();return v})()`);
  assert.ok(rec, `${label}: scrub fixture disappeared`); assert.equal(rec.name, "Browser Legacy Secret Fixture"); assert.equal(Object.hasOwn(rec, "providerToken"), false, `${label}: IndexedDB secret field survived scrub`); assert.equal(JSON.stringify(rec).includes(TEST_SECRET), false);
}

async function verify(cdp, label, urls, errors) {
  const body = await cdp.evaluate(`document.body?.innerText||''`); assert.ok(body.length > 500); assert.match(body, /PERSONA/i);
  assert.deepEqual(externalRequests(urls), [], `${label}: local startup made an external request`);
  await verifySecretMigrationAndUi(cdp, label);
  await verifyIndexedDbScrub(cdp, label);
  assert.deepEqual(externalRequests(urls), [], `${label}: local scrub made an external request`);
  assert.deepEqual(errors, [], `${label}: runtime errors: ${errors.join(" | ")}`);
}

const chrome = findChrome();
const profileDir = await mkdtemp(join(tmpdir(), "persona-chrome-"));
const proc = spawn(chrome,["--headless=new","--no-sandbox","--disable-gpu","--disable-dev-shm-usage","--allow-file-access-from-files","--remote-debugging-port=0",`--user-data-dir=${profileDir}`,"about:blank"],{stdio:["ignore","ignore","pipe"]});
let stderr="",server,cdp; proc.stderr.on("data",c=>stderr+=String(c));
try {
  cdp=new CDP(await waitForDevTools(profileDir,proc)); await cdp.connect(); await cdp.send("Page.enable"); await cdp.send("Runtime.enable"); await cdp.send("Network.enable"); await cdp.send("Log.enable");
  let urls=[],errors=[]; cdp.on("Network.requestWillBeSent",p=>urls.push(p.request?.url||"")); cdp.on("Runtime.exceptionThrown",p=>errors.push(p.exceptionDetails?.exception?.description||p.exceptionDetails?.text||"Uncaught exception")); cdp.on("Log.entryAdded",p=>{const e=p.entry||{};if(e.level==='error'&&!/favicon\.ico/i.test(e.text||''))errors.push(e.text||'Browser log error')});
  await navigate(cdp,pathToFileURL(indexPath).href); urls=[];errors=[]; await prepareApp(cdp); await verify(cdp,"direct-file",urls,errors);
  server=createServer((req,res)=>{if(req.url==='/'||req.url==='/index.html'){res.writeHead(200,{"content-type":"text/html; charset=utf-8","cache-control":"no-store"});res.end(html);return}if(req.url==='/favicon.ico'){res.writeHead(204);res.end();return}res.writeHead(404);res.end('Not found')});
  await new Promise(r=>server.listen(0,'127.0.0.1',r)); const address=server.address(); assert.ok(address&&typeof address==='object');
  await navigate(cdp,`http://127.0.0.1:${address.port}/index.html`); urls=[];errors=[]; await prepareApp(cdp); await verify(cdp,"http-hosted",urls,errors);
  console.log("browser-smoke: PASS (direct-file + HTTP-hosted; persistent secret removal; sessionStorage or documented direct-file memory fallback; IndexedDB scrub; Settings security UX; local-mode network isolation)");
} finally {
  cdp?.close(); const exited=proc.exitCode===null?once(proc,'exit').catch(()=>[]):Promise.resolve([]); if(proc.exitCode===null)proc.kill('SIGTERM'); await Promise.race([exited,sleep(2000)]); if(proc.exitCode===null){proc.kill('SIGKILL');await Promise.race([exited,sleep(2000)])} if(server){server.closeAllConnections?.();await new Promise(r=>server.close(()=>r()))} await sleep(250); await rm(profileDir,{recursive:true,force:true,maxRetries:10,retryDelay:150});
}
if(stderr&&/(?:SyntaxError|ReferenceError|Uncaught TypeError)/i.test(stderr))throw new Error(`Chrome stderr contained a JavaScript failure: ${stderr.slice(-4000)}`);
