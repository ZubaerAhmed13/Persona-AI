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

async function testV4PeopleActivity(cdp) {
  await openView(cdp, "interactions");
  await waitUntil(cdp, '!!document.querySelector("#v4ActivityTimeline .v4-activity-entry")', "unified Activity timeline");
  const initial = await cdp.evaluate('(() => ({ heading:document.querySelector(".page-title")?.textContent, kinds:[...document.querySelectorAll("#v4ActivityTimeline .v4-activity-kind")].map(el=>el.textContent), controls:!!document.querySelector("[data-list-type=\\"interactions\\"]") && !!document.querySelector("[data-action=\\"addInteraction\\"]") }))()');
  assert.equal(initial.heading, "Activity", "Workspace heading was not updated");
  assert.equal(initial.controls, true, "Legacy interaction list/edit affordances were replaced");
  for (const label of ["Interaction", "Memory", "Decision", "Commitment", "Follow-up"]) {
    assert.ok(initial.kinds.includes(label), "Activity missed fixture category: " + label);
  }
  const personFilter = await cdp.evaluate('(() => { const s=document.querySelector("#v4ActivityPerson"); s.value="v31-person"; s.dispatchEvent(new Event("change",{bubbles:true})); return !!document.querySelector("#v4ActivityTimeline [data-v4-results]"); })()');
  assert.equal(personFilter,true);
  const selectedNames = await cdp.evaluate('[...document.querySelectorAll("#v4ActivityTimeline .v4-activity-entry-foot>span")].map(el=>el.textContent)');
  assert.ok(selectedNames.every((name)=>name === "V3.1 Compatibility Person"), "Person filter showed another person's activity");
  await cdp.evaluate('(() => { const q=document.querySelector("#v4ActivitySearch");q.value="unlikely search that matches nothing";q.dispatchEvent(new Event("input",{bubbles:true})); })()');
  assert.equal(await cdp.evaluate('(document.querySelector("#v4ActivityTimeline [data-v4-count]")?.textContent || "")'), "0 of 0 recorded items");
  await openView(cdp, "people");
  assert.equal(await cdp.evaluate('(() => { const el=document.querySelector(\'[data-action="viewPerson"][data-arg="v31-person"]\'); if (!el) return false; el.click(); return true; })()'), true, "Could not open historical person profile");
  await waitUntil(cdp, '!!document.querySelector(".v4-person-snapshot") && !!document.querySelector("#v4PersonTimeline")', "Stage 4 person summary and activity");
  const profile = await cdp.evaluate('(() => ({ name:document.querySelector(".ph-name")?.textContent, follow:!!document.querySelector(\'.v4-person-snapshot [data-action="addFollowUp"][data-arg="v31-person"]\'), edit:!!document.querySelector(\'.v4-person-snapshot [data-action="editPerson"][data-arg="v31-person"]\'), timeline:document.querySelectorAll("#v4PersonTimeline .v4-activity-entry").length }))()');
  assert.equal(profile.name, "V3.1 Compatibility Person");
  assert.ok(profile.follow && profile.edit, "Contextual quick actions absent");
  assert.ok(profile.timeline>0, "Person timeline has no fixture records");
  await cdp.evaluate('(() => { const q=document.querySelector("#v4PersonSearch");q.value="hiking";q.dispatchEvent(new Event("input",{bubbles:true})); })()');
  const count = await cdp.evaluate('document.querySelector("#v4PersonTimeline [data-v4-count]")?.textContent || ""');
  assert.match(count,/recorded items$/);
  assert.equal(await cdp.evaluate('!!document.querySelector(".v4-person-snapshot")'),true);
}

async function testV4SmartCaptureAndContacts(cdp) {
  await openView(cdp,"people");
  const launcher = await cdp.evaluate('(() => { const b=document.querySelector(\'#view [data-action="importContactsCSV"]\');if(!b)return false;b.click();return true;})()');
  assert.equal(launcher,true,"CSV contact import entry not visible on People page");
  await waitUntil(cdp,'!!document.querySelector("#v4csvFile")',"local CSV picker");
  const csv = "Full Name,Organization,Notes\nV3.1 Compatibility Person,Old,Existing duplicate\nStage5 Import Person,Example Co,Imported safely";
  const attach = await cdp.evaluate('(() => { const input=document.querySelector("#v4csvFile");if(!input)return false;const dt=new DataTransfer();dt.items.add(new File(['+JSON.stringify(csv)+'],"contacts.csv",{type:"text/csv"}));input.files=dt.files;input.dispatchEvent(new Event("change",{bubbles:true}));return true;})()');
  assert.equal(attach,true);
  await waitUntil(cdp,'(document.querySelector("#v4csvPreview")?.textContent || "").includes("2 rows reviewed")',"CSV import preview");
  const preview = await cdp.evaluate('(() => ({checks:[...document.querySelectorAll("[data-csv-include]")].map(e=>({checked:e.checked,disabled:e.disabled})),text:document.querySelector("#v4csvPreview")?.textContent||""}))()');
  assert.equal(preview.checks.length,2);
  assert.equal(preview.checks[0].disabled,true,"Existing person should not be re-imported automatically");
  assert.equal(preview.checks[1].checked,true);
  await cdp.evaluate('(() => { const b=[...document.querySelectorAll("#modalRoot button")].find(x=>x.textContent.includes("Import selected"));b.click();})()');
  await waitUntil(cdp,'(document.querySelector("#view")?.textContent||"").includes("Stage5 Import Person") && !document.querySelector("#v4csvFile")',"CSV contact import commit",15000);
  const stored=await snapshot(cdp);
  const imported=stored.people.filter(p=>p.name==="Stage5 Import Person");
  assert.equal(imported.length,1,"Contact import did not commit exactly one new person");
  assert.equal(stored.people.filter(p=>p.name==="V3.1 Compatibility Person").length,1,"CSV duplicate created an extra existing person");

  const searchReady=await cdp.evaluate('(() => { const s=document.querySelector("#globalSearchInput");s.value="hiking";s.dispatchEvent(new Event("input",{bubbles:true}));return true;})()');
  assert.equal(searchReady,true);
  await waitUntil(cdp,'(document.querySelector("#searchResults")?.textContent||"").toLowerCase().includes("hiking")',"ranked search for stored memory");
  const searchResultCount=await cdp.evaluate('document.querySelectorAll("#searchResults [data-sr]").length');
  assert.ok(searchResultCount>0 && searchResultCount<16,"Search should find relevant results without unrelated records");
  await cdp.evaluate('(() => { const s=document.querySelector("#globalSearchInput");s.value="";s.dispatchEvent(new Event("input",{bubbles:true}));})()');

  const smartButton=await cdp.evaluate('(() => { const b=document.querySelector(\'[data-action="universalCapture"]\');if(!b)return false;b.click();return true;})()');
  assert.equal(smartButton,true,"Smart Capture action missing");
  await waitUntil(cdp,'!!document.querySelector("#v4captureText")',"Smart Capture dialog");
  const note="I spoke with Stage5 Import Person yesterday about the project.";
  await cdp.evaluate('(() => { const el=document.querySelector("#v4captureText");el.value='+JSON.stringify(note)+';el.dispatchEvent(new Event("input",{bubbles:true}));document.querySelector("#v4captureReview").click();})()');
  await waitUntil(cdp,'!!document.querySelector("#v4capturePerson")',"smart capture review fields");
  const matched=await cdp.evaluate('document.querySelector("#v4capturePerson")?.selectedOptions[0]?.textContent');
  assert.equal(matched,"Stage5 Import Person","Whole-token person detection failed");
  await cdp.evaluate('(() => { const b=[...document.querySelectorAll("#modalRoot button")].find(e=>e.textContent.includes("Save reviewed interaction"));b.click();})()');
  await waitUntil(cdp,'!document.querySelector("#v4captureText")',"reviewed capture commit");
  const after=await snapshot(cdp);
  const records=after.interactions.filter(r=>r.personId===imported[0].id && r.observed===note);
  assert.equal(records.length,1,"Smart Capture did not persist the reviewed text for the confirmed contact");
  assert.equal(records[0].source,"reviewed local smart capture","Smart Capture origin metadata missing");
}

async function testV4Stage6Planning(cdp) {
  const seeded = await cdp.evaluate(`(async () => {
    const db = await new Promise((resolve,reject)=>{ const req=indexedDB.open("persona-ai"); req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error); });
    try {
      await new Promise((resolve,reject)=>{
        const tx=db.transaction(["followUps","commitments"],"readwrite");
        tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
        tx.objectStore("followUps").put({id:"stage6-live-followup",personId:"v31-person",text:"Stage 6 overdue check-in",dueDate:"2026-10-11",status:"active",schemaVersion:7});
        tx.objectStore("commitments").put({id:"stage6-legacy-commit",personId:"v31-person",description:"Stage 6 legacy dueDate promise",dueDate:"2026-10-11",completed:false,schemaVersion:7});
      });
    } finally { db.close(); }
    return true;
  })()`);
  assert.equal(seeded,true);
  await reload(cdp);
  const nav = await cdp.evaluate('(() => { const b=document.querySelector(\'#v4PrimaryNav [data-v4-view="followups"]\'); if(!b)return false;b.click();return true;})()');
  assert.equal(nav,true,"Stage 6 Follow-ups navigation unavailable");
  await waitUntil(cdp,'!!document.querySelector(\'[data-action="v4SnoozeTask"][data-arg="stage6-live-followup"]\')',"Stage 6 due task row");
  assert.match(await cdp.evaluate('document.querySelector("#view")?.textContent||""'),/Stage 6 overdue check-in/);
  await cdp.evaluate('document.querySelector(\'[data-action="v4SnoozeTask"][data-arg="stage6-live-followup"][data-days="3"]\').click()');
  await waitUntil(cdp,'!document.querySelector(\'[data-action="v4SnoozeTask"][data-arg="stage6-live-followup"]\')',"snoozed item leaves due category");
  let snap=await snapshot(cdp);
  const postponed=snap.followUps.find(x=>x.id==="stage6-live-followup");
  assert.equal(postponed.status,"snoozed");
  assert.ok(postponed.dueDate,"Snoozing must save a due date");
  await cdp.evaluate('document.querySelector(\'[data-action="v4FollowUpTab"][data-arg="snoozed"]\').click()');
  await waitUntil(cdp,'!!document.querySelector(\'[data-action="v4RescheduleTask"][data-arg="followUp|stage6-live-followup"]\')',"snoozed item review");
  await cdp.evaluate('document.querySelector(\'[data-action="v4RescheduleTask"][data-arg="followUp|stage6-live-followup"]\').click()');
  await waitUntil(cdp,'!!document.querySelector("#v4s6Date")',"Reschedule date picker");
  const tomorrow=await cdp.evaluate('(() => {const now=new Date();now.setDate(now.getDate()+1);return [now.getFullYear(),String(now.getMonth()+1).padStart(2,"0"),String(now.getDate()).padStart(2,"0")].join("-");})()');
  await cdp.evaluate('(() => {document.querySelector("#v4s6Date").value=' + JSON.stringify(tomorrow) + ';const btn=[...document.querySelectorAll("#modalRoot button")].find(b=>b.textContent.includes("Save date"));btn.click();})()');
  await waitUntil(cdp,'!document.querySelector("#v4s6Date")',"reschedule persisted");
  snap=await snapshot(cdp);
  const updated=snap.followUps.find(x=>x.id==="stage6-live-followup");
  assert.equal(updated.dueDate.slice(0,10),tomorrow);
  assert.equal(updated.status,"active");
  await openView(cdp,"commitments");
  await waitUntil(cdp,'!!document.querySelector(".v4s6-panel")',"commitment review planner");
  const page=await cdp.evaluate('document.querySelector("#view")?.textContent||""');
  assert.ok(page.includes("Stage 6 legacy dueDate promise"),"Legacy commitment dueDate was hidden from priorities");
  await openView(cdp,"weekly");
  assert.equal(await cdp.evaluate('!!document.querySelector(".v4s6-panel")'),true,"Weekly planning summary missing");
}

async function testV4Stage7GroundedCopilot(cdp) {
  await openView(cdp,"copilot");
  await waitUntil(cdp,'!!document.querySelector("#v4s7EvidenceDesk")',"Stage 7 evidence desk");
  const noPerson=await cdp.evaluate('(() => { const inp=document.querySelector("#copInput");inp.value="What did I promise?";document.querySelector(\'[data-action="askCopilot"]\').click();return document.querySelector("#copOut")?.textContent||"";})()');
  assert.ok(noPerson.includes("Select a person"),"Local Copilot must not silently choose a person");
  const selected=await cdp.evaluate('(() => {const el=document.querySelector("#contextPersonSelect");if(![...el.options].some(o=>o.value==="v31-person"))return false;el.value="v31-person";el.dispatchEvent(new Event("change",{bubbles:true}));return true;})()');
  assert.equal(selected,true,"Historic person is missing from context");
  await waitUntil(cdp,'!!document.querySelector("#v4s7EvidenceDesk")',"person-scoped evidence desk");
  await cdp.evaluate('(() => {document.querySelector("#copInput").value="What did I promise?";document.querySelector(\'[data-action="askCopilot"]\').click();})()');
  await waitUntil(cdp,'!!document.querySelector("#copOut .v4s7-answer")',"grounded local response");
  const response=await cdp.evaluate('(() => ({txt:document.querySelector("#copOut")?.textContent||"",sources:document.querySelectorAll("#copOut [data-action=\\"v4EvidenceSource\\"]").length}))()');
  assert.match(response.txt,/Local analysis/);
  assert.ok(response.sources>0,"Person-scoped Copilot should cite stored commitments");
  await cdp.evaluate('document.querySelector("#copOut [data-action=\\"v4EvidenceSource\\"]").click()');
  await waitUntil(cdp,'(document.querySelector("#modalRoot")?.textContent||"").includes("Recorded source")',"source inspection modal");
  await cdp.evaluate('(() => {const b=[...document.querySelectorAll("#modalRoot button")].find(x=>x.textContent.trim()==="Close");b?.click();})()');
  await cdp.evaluate('document.querySelector(\'[data-action="v4ConversationBrief"]\').click()');
  await waitUntil(cdp,'(document.querySelector("#copOut")?.textContent||"").includes("Conversation preparation")',"source-backed conversation brief");
  assert.ok(await cdp.evaluate('document.querySelectorAll("#copOut [data-action=\\"v4EvidenceSource\\"]").length>0'));
}

async function testV4Stage8EvidenceNetwork(cdp) {
  const before=canonical(await snapshot(cdp));
  await openView(cdp,"relationships");
  await waitUntil(cdp,'!!document.querySelector("#v4s8Panel .v4s8-map")',"Stage 8 evidence network");
  const initial=await cdp.evaluate('(() => ({nodes:document.querySelectorAll("#v4s8Panel .v4s8-map-node").length,lines:document.querySelectorAll("#v4s8Panel svg line").length,classic:!!document.querySelector(".v4s8-classic summary")}))()');
  assert.equal(initial.nodes,1,"Single existing fixture contact should have a diagram node");
  assert.equal(initial.lines,1,"One line from the user per contact, with no invented cross-person edges");
  await cdp.evaluate('document.querySelector(\'#v4s8Panel .v4s8-person-row[data-arg="v31-person"]\').click()');
  await waitUntil(cdp,'!!document.querySelector("#v4s8Selection .v4s8-source")',"contact evidence list");
  const details=await cdp.evaluate('document.querySelector("#v4s8Selection")?.innerText || ""');
  assert.match(details,/V3.1 Compatibility Person/);
  await cdp.evaluate('document.querySelector("#v4s8Selection .v4s8-source").click()');
  await waitUntil(cdp,'(document.querySelector("#modalRoot")?.innerText||"").includes("Source record")',"source evidence inspection");
  await cdp.evaluate('(() => { const close=[...document.querySelectorAll("#modalRoot button")].find(x=>x.textContent.trim()==="Close");close?.click();})()');
  await cdp.evaluate('(() => {const input=document.querySelector("#v4s8Search");input.value="no existing contact matches this";input.dispatchEvent(new Event("input",{bubbles:true}));})()');
  await waitUntil(cdp,'document.querySelectorAll("#v4s8Panel .v4s8-map-node").length===0',"network contact search");
  const empty=await cdp.evaluate('document.querySelector("#v4s8NetworkRoot")?.innerText||""');
  assert.match(empty,/No contacts match/);
  await cdp.evaluate('(() => {const input=document.querySelector("#v4s8Search");input.value="";input.dispatchEvent(new Event("input",{bubbles:true}));})()');
  await waitUntil(cdp,'document.querySelectorAll("#v4s8Panel .v4s8-map-node").length===1',"network filter reset");

  await openView(cdp,"decisionlab");
  await waitUntil(cdp,'!!document.querySelector(\'[data-action="v4DecisionEvidence"]\')',"Decision Lab evidence preview");
  await cdp.evaluate('(() => {document.querySelector("#dl_person").value="v31-person";document.querySelector("#dl_decision").value="Should I ask about the project update?";document.querySelector("#dl_impact").value="High";document.querySelector("#dl_rev").value="Irreversible";document.querySelector(\'[data-action="v4DecisionEvidence"]\').click();})()');
  await waitUntil(cdp,'!!document.querySelector("#v4s8DecisionOutput .v4s8-review")',"Decision Lab read-only context");
  const review=await cdp.evaluate('document.querySelector("#v4s8DecisionOutput")?.innerText||""');
  assert.match(review,/hard-to-reverse/);
  assert.match(review,/Relevant recorded context/);
  assert.ok(await cdp.evaluate('document.querySelectorAll("#v4s8DecisionOutput .v4s8-source").length>0'));

  await openView(cdp,"patterns");
  assert.ok(await cdp.evaluate('!!document.querySelector("#v4s8Panel")'),"Pattern evidence coverage section missing");
  assert.deepEqual(canonical(await snapshot(cdp)),before,"Exploring Stage 8 network or decision context changed records");
}

async function testV4Stage9MobileAccessibility(cdp) {
  const before=canonical(await snapshot(cdp));
  try {
    for (const width of [320,390,720]) {
      await cdp.send("Emulation.setDeviceMetricsOverride",{width,height:740,deviceScaleFactor:1,mobile:true});
      for (const view of ["dashboard","people","interactions","followups","copilot"]) {
        if(view==="followups") {
          const found=await cdp.evaluate('(() => {const b=document.querySelector(\'#v4PrimaryNav [data-v4-view="followups"]\');if(!b)return false;b.click();return true;})()');
          assert.equal(found,true,"Stage 9 Follow-ups workspace button missing");
          await waitUntil(cdp,'(document.querySelector("#view .page-title")?.textContent||"").includes("Follow-ups")',"Stage 9 Follow-ups route");
        } else await openView(cdp,view);
        const result=await cdp.evaluate('(() => {const nav=document.querySelector("#v4MobileNav"),active=nav?.querySelector(\'[aria-current="page"]\');return {width:window.innerWidth,scrollWidth:document.documentElement.scrollWidth,navVisible:!!nav&&getComputedStyle(nav).display!=="none",navCount:nav?.querySelectorAll("button").length,navScrollable:nav?.scrollWidth>nav?.clientWidth,activeHeight:active?.getBoundingClientRect().height,titleRole:document.querySelector("#view .page-title")?.getAttribute("role"),titleLevel:document.querySelector("#view .page-title")?.getAttribute("aria-level"),skip:!!document.querySelector("#v4s9SkipLink"),inputSize:parseFloat(getComputedStyle(document.querySelector("#globalSearchInput")).fontSize)};})()');
        assert.equal(result.navVisible,true,"Mobile navigation hidden on "+view+" at "+width+"px");
        assert.equal(result.navCount,6,"Mobile nav lost a destination at "+width+"px");
        assert.equal(result.navScrollable,true,"Six destinations should remain scrollable at "+width+"px");
        assert.ok(result.activeHeight>=44,"Active mobile target below 44px at "+width+"px ("+result.activeHeight+"px)");
        assert.ok(result.scrollWidth<=result.width+2,"Page overflow at "+width+"px in "+view+": "+result.scrollWidth+"px");
        assert.equal(result.titleRole,"heading");
        assert.equal(result.titleLevel,"1");
        assert.equal(result.skip,true);
        assert.ok(result.inputSize>=16,"Mobile search input could trigger automatic zoom at "+width+"px");
      }
    }
    await openView(cdp,"people");
    const opened=await cdp.evaluate('(() => {const button=document.querySelector(\'#quickAdd [data-action="addPerson"]\');if(!button)return false;button.focus();button.click();return true;})()');
    assert.equal(opened,true,"Add Person modal trigger unavailable");
    await waitUntil(cdp,'!!document.querySelector("#modalRoot .modal-backdrop")',"mobile modal");
    await sleep(130);
    const info=await cdp.evaluate('(() => {const root=document.querySelector("#modalRoot .modal-backdrop");const focusables=[...root.querySelectorAll(\'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])\')].filter(e=>e.getClientRects().length&&!e.hidden);return {labelled:root.getAttribute("aria-labelledby"),name:root.querySelector("#v4s9ModalTitle")?.textContent,buttons:focusables.length,focusInside:root.contains(document.activeElement)};})()');
    assert.equal(info.labelled,"v4s9ModalTitle");
    assert.ok(info.name?.length>0);
    assert.ok(info.buttons>=2);
    assert.equal(info.focusInside,true,"Modal does not focus a dialog control");

    const trapped=await cdp.evaluate('(() => {const root=document.querySelector("#modalRoot .modal-backdrop"),f=[...root.querySelectorAll(\'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])\')].filter(e=>e.getClientRects().length&&!e.hidden);f[f.length-1].focus();document.dispatchEvent(new KeyboardEvent("keydown",{key:"Tab",bubbles:true,cancelable:true}));const forward=document.activeElement===f[0];f[0].focus();document.dispatchEvent(new KeyboardEvent("keydown",{key:"Tab",shiftKey:true,bubbles:true,cancelable:true}));return forward&&document.activeElement===f[f.length-1];})()');
    assert.equal(trapped,true,"Tab/Shift+Tab escaped the modal");
    await cdp.evaluate('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}))');
    assert.equal(await cdp.evaluate('!!document.querySelector("#modalRoot .modal-backdrop")'),false);
    assert.equal(await cdp.evaluate('document.activeElement===document.querySelector(\'#quickAdd [data-action="addPerson"]\')'),true,"Closing dialog did not return focus");

    await cdp.send("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"reduce"}]});
    const motion=await cdp.evaluate('getComputedStyle(document.querySelector("#view")).animationName');
    assert.equal(motion,"none","Reduced motion should suppress decorative page animation");
  } finally {
    await cdp.send("Emulation.setEmulatedMedia",{features:[]});
    await cdp.send("Emulation.clearDeviceMetricsOverride");
    await openView(cdp,"dashboard");
  }
  assert.deepEqual(canonical(await snapshot(cdp)),before,"Stage 9 responsive/a11y interactions mutated user data");
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

async function testRejectCorruptBackup(cdp) {
  const before = canonical(await snapshot(cdp));
  await openData(cdp);
  const bad = JSON.stringify({
    app: "PERSONA AI", schemaVersion: 7,
    data: { people: [{ id: "corrupt-person", name: "Rejected" }], unknownStore: [] }
  });
  await attachJson(cdp, "#importFile", "corrupt.json", bad);
  await sleep(350);
  const modal = await cdp.evaluate('document.querySelector("#modalRoot")?.innerText || ""');
  assert.equal(modal.includes("Import Preview"), false, "Invalid backup unexpectedly reached import confirmation");
  assert.deepEqual(canonical(await snapshot(cdp)), before, "Rejected backup unexpectedly modified IndexedDB");
}

async function testAtomicPersonCascade(cdp) {
  await openView(cdp, "people");
  const before = await snapshot(cdp);
  assert.ok(before.people.some((p) => p.id === "v31-person"), "Historical subject missing before person deletion test");
  // Historical child history can refer to a person's owned parent record
  // without a personId of its own. The cascade must remove these safely.
  await cdp.evaluate('(async () => { const db = await new Promise((resolve, reject) => { const q=indexedDB.open("persona-ai"); q.onsuccess=()=>resolve(q.result); q.onerror=()=>reject(q.error); }); try { await new Promise((resolve,reject) => { const tx=db.transaction(["playbookHistory","signalHistory","decisionOptions","auditLog"],"readwrite"); tx.oncomplete=resolve; tx.onabort=()=>reject(tx.error); tx.objectStore("playbookHistory").put({id:"v4-indirect-playbook",playbookId:"v31-playbook"}); tx.objectStore("signalHistory").put({id:"v4-indirect-signal",signalId:"v31-signal"}); tx.objectStore("decisionOptions").put({id:"v4-indirect-decision",decisionId:"v31-decision"}); tx.objectStore("auditLog").put({id:"v4-indirect-audit",store:"playbookHistory",recordId:"v4-indirect-playbook"}); }); } finally { db.close(); } })()');

  assert.equal(await cdp.evaluate('(() => { const el = document.querySelector(\'[data-action="viewPerson"][data-arg="v31-person"]\'); if (!el) return false; el.click(); return true; })()'), true, "Fixture person profile unavailable");
  await waitUntil(cdp, '!!document.querySelector(\'[data-action="deletePerson"][data-arg="v31-person"]\')', "person delete control");
  await cdp.evaluate('document.querySelector(\'[data-action="deletePerson"][data-arg="v31-person"]\').click()');
  await waitUntil(cdp, '(document.querySelector("#modalRoot")?.innerText || "").includes("Delete person")', "person delete confirmation");
  await clickModalByText(cdp, "Delete person");
  // Observe persistent storage, not a transient DOM state: modal teardown can
  // lag behind the completed IndexedDB transaction on slower CI browsers.
  await waitUntil(cdp, '(async () => { const db = await new Promise((resolve, reject) => { const req = indexedDB.open("persona-ai"); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }); try { return !(await new Promise((resolve, reject) => { const req = db.transaction("people", "readonly").objectStore("people").get("v31-person"); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); })); } finally { db.close(); } })()', "persisted primary person deletion", 15000);
  const after = await snapshot(cdp);
  assert.ok(!after.people.some((p) => p.id === "v31-person"), "Primary person record survived cascade deletion");
  for (const [store, rows] of Object.entries(after)) {
    assert.ok(!rows.some((row) => row.personId === "v31-person"), "Linked record survived person cascade in " + store);
  }
  for (const [store, id] of [
    ["playbookHistory", "v4-indirect-playbook"],
    ["signalHistory", "v4-indirect-signal"],
    ["decisionOptions", "v4-indirect-decision"],
    ["auditLog", "v4-indirect-audit"]
  ]) assert.ok(!after[store].some((row) => row.id === id),
    "Indirect record survived person erasure: " + store + "." + id);
  assert.ok(after.people.some((p) => p.name === WORKFLOW_PERSON), "Deleting subject removed unrelated person");
  await reload(cdp);
  const persisted = await snapshot(cdp);
  assert.deepEqual(canonical(persisted), canonical(after), "Deleted person or linked records returned after reload");
}

async function testV4Workspace(cdp) {
  const names = await cdp.evaluate('Array.from(document.querySelectorAll("#v4PrimaryNav [data-v4-view]"), b => b.dataset.v4View)');
  assert.deepEqual(names, ["dashboard", "people", "interactions", "followups", "patterns", "copilot"],
    "v4 top-level workspace destinations changed");
  assert.equal(await cdp.evaluate('document.querySelector("#primaryNav").hidden'), true,
    "Historical modules should be available on demand by default");
  await cdp.evaluate('document.querySelector("#v4AdvancedToggle").click()');
  assert.equal(await cdp.evaluate('document.querySelector("#primaryNav").hidden'), false, "All tools cannot be expanded");
  assert.equal(await cdp.evaluate('document.querySelector("#v4AdvancedToggle").getAttribute("aria-expanded")'), "true");
  await cdp.evaluate('document.querySelector("#v4AdvancedToggle").click()');
  await cdp.evaluate('document.querySelector(\'#v4PrimaryNav [data-v4-view="followups"]\').click()');
  await waitUntil(cdp, '(document.querySelector(".page-title")?.innerText || "") === "Follow-ups"', "actionable follow-ups page");
  assert.equal(await cdp.evaluate('!!document.querySelector(\'#v4PrimaryNav [data-v4-view="followups"][aria-current="page"]\')'), true);
  assert.equal(await cdp.evaluate('!!document.querySelector(\'[data-action="completeFollowUp"][data-arg="v31-followup"]\')'), true,
    "Existing v3.1 follow-up is not actionable in v4 workspace");
  await cdp.evaluate('document.querySelector(\'[data-action="completeFollowUp"][data-arg="v31-followup"]\').click()');
  await waitUntil(cdp, '!document.querySelector(\'[data-action="completeFollowUp"][data-arg="v31-followup"]\')', "completed v4 follow-up");
  const records = await snapshot(cdp);
  assert.equal(records.followUps.find((r) => r.id === "v31-followup")?.status, "done",
    "v4 follow-up completion did not persist to existing IndexedDB store");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
  try {
    await waitUntil(cdp, 'getComputedStyle(document.querySelector("#v4MobileNav")).display === "grid"', "six-option mobile navigation");
    const mobile = await cdp.evaluate('Array.from(document.querySelectorAll("#v4MobileNav [data-v4-mobile]"), b => b.dataset.v4Mobile)');
    assert.deepEqual(mobile, names, "Mobile workspace omitted a primary destination");
    await cdp.evaluate('document.querySelector(\'#v4MobileNav [data-v4-mobile="copilot"]\').click()');
    await waitUntil(cdp, '(document.querySelector(".page-title")?.innerText || "").includes("Copilot")', "mobile Copilot navigation");
    assert.equal(await cdp.evaluate('!!document.querySelector(\'#v4MobileNav [data-v4-mobile="copilot"][aria-current="page"]\')'), true);
  } finally {
    await cdp.send("Emulation.clearDeviceMetricsOverride");
  }
  await openView(cdp, "people");
}

async function testImportedIdMarkupSafety(cdp) {
  // Historic plaintext backups can contain IDs with quotes. The ID must
  // survive unchanged, but it must NEVER be parsed as an HTML event attribute.
  const injectedId = 'imported-id" onmouseover="window.__personaInjected = true';
  const hostileText = '<img src=x onerror="window.__personaInjected = true">';
  await cdp.evaluate('(async () => { const db = await new Promise((resolve, reject) => { const r=indexedDB.open("persona-ai"); r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error); }); try { await new Promise((resolve,reject) => { const tx=db.transaction(["people","memories"],"readwrite"); tx.oncomplete=resolve; tx.onabort=()=>reject(tx.error); tx.objectStore("people").put({ id:' + JSON.stringify(injectedId) + ', name:"Malicious ID Fixture", schemaVersion:7 }); tx.objectStore("memories").put({ id:"v4-hostile-memory", personId:' + JSON.stringify(injectedId) + ', info:' + JSON.stringify(hostileText) + ', date:"2026-10-13T10:00:00.000Z", schemaVersion:7 }); }); } finally { db.close(); } })()');
  await reload(cdp);
  await openView(cdp, "people");
  const test = await cdp.evaluate('(() => { const id=' + JSON.stringify(injectedId) + '; const card=[...document.querySelectorAll(".person-card")].find(el => el.dataset.arg === id); if (!card) return {found:false}; return {found:true, injectedAttr:card.hasAttribute("onmouseover"), name:card.querySelector(".person-name")?.textContent}; })()');
  assert.equal(test.found, true, "Imported person ID was changed by markup encoding");
  assert.equal(test.injectedAttr, false, "HTML event handler injected through historical person ID");
  assert.equal(test.name, "Malicious ID Fixture");
  await cdp.evaluate('(() => { const id=' + JSON.stringify(injectedId) + '; [...document.querySelectorAll(".person-card")].find(el => el.dataset.arg === id).click(); })()');
  await waitUntil(cdp, '(document.querySelector(".ph-name")?.textContent || "") === "Malicious ID Fixture"', "hostile-ID profile navigation");
  const escaped = await cdp.evaluate('({ imageHandlers:[...document.querySelectorAll("#view [onerror],#view [onmouseover]")].length, memoryDisplayed:(document.querySelector("#view")?.textContent || "").includes("<img src=x"), exploited:!!window.__personaInjected })');
  assert.equal(escaped.imageHandlers, 0, "Imported note became an event-bearing HTML element");
  assert.equal(escaped.exploited, false, "A hostile imported note executed JavaScript");
  assert.equal(escaped.memoryDisplayed, true, "Imported memory was not displayed as escaped text");
}

async function testSevenDayAgenda(cdp) {
  const future = await cdp.evaluate(`(async () => {
    const today = new Date();
    today.setDate(today.getDate() + 3);
    const day = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, "0"),
      String(today.getDate()).padStart(2, "0")
    ].join("-");
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open("persona-ai");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(["followUps", "commitments", "memories"], "readwrite");
        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error);
        tx.objectStore("followUps").put({
          id: "v4-agenda-followup", personId: "v4-migrate-check",
          text: "Future follow-up action", status: "snoozed", dueDate: day, schemaVersion: 7
        });
        tx.objectStore("commitments").put({
          id: "v4-agenda-commitment", personId: "v4-migrate-check",
          description: "Legacy commitment action", completed: false, dueDate: day, schemaVersion: 7
        });
        tx.objectStore("memories").put({
          id: "v4-agenda-memory", personId: "v4-migrate-check",
          text: "Future memory action", reminderDate: day, schemaVersion: 7
        });
      });
    } finally { db.close(); }
    return day;
  })()`);
  assert.match(future, /^\d{4}-\d{2}-\d{2}$/);
  await reload(cdp);
  await openView(cdp, "dashboard");
  await waitUntil(cdp, '(document.querySelector(".persona-agenda")?.innerText || "").includes("Future follow-up action")',
    "seven-day upcoming agenda");
  const details = await cdp.evaluate('(() => { const agenda=document.querySelector(".persona-agenda"); return { text:agenda?.innerText, futureRows:agenda?.querySelectorAll(".persona-agenda-row").length, completedButton:!!agenda?.querySelector(\'[data-action="completeFollowUp"][data-arg="v4-agenda-followup"]\'), dateText:agenda?.querySelector(".persona-agenda-date")?.textContent }; })()');
  assert.ok(details.text.includes("Legacy commitment action"), "Legacy dueDate commitment missing from week ahead");
  assert.ok(details.text.includes("Future memory action"), "Memory reminder missing from week ahead");
  assert.ok(details.futureRows >= 3, "Fewer future actions than expected");
  assert.equal(details.completedButton, true);
  assert.equal(details.dateText, future, "Agenda shifted a calendar date due to time zone");
  await cdp.evaluate('document.querySelector(\'.persona-agenda [data-action="completeFollowUp"][data-arg="v4-agenda-followup"]\').click()');
  await waitUntil(cdp, '!document.querySelector(\'.persona-agenda [data-action="completeFollowUp"][data-arg="v4-agenda-followup"]\')',
    "completed agenda follow-up disappears from upcoming items");
  const saved = await snapshot(cdp);
  assert.equal(saved.followUps.find((row)=>row.id==="v4-agenda-followup")?.status, "done",
    "Agenda completion was not persisted in the existing followUps store");
}

async function testLegacyMigrationRecovery(cdp) {
  const seeded = await cdp.evaluate('(async () => { const db = await new Promise((resolve, reject) => { const r=indexedDB.open("persona-ai"); r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error); }); try { const due = new Date(Date.now() - 86400000).toISOString().slice(0,10); await new Promise((resolve,reject) => { const tx=db.transaction(["people","followUps"],"readwrite"); tx.oncomplete=resolve; tx.onabort=()=>reject(tx.error); tx.objectStore("people").put({ id:"v4-migrate-check", name:"Migration Test Person", createdAt:"2025-01-01T00:00:00.000Z" }); tx.objectStore("followUps").put({ id:"v4-expired-snooze", personId:"v4-migrate-check", text:"Expired snooze test reminder", dueDate:due, status:"snoozed", createdAt:"2025-01-01T00:00:00.000Z", schemaVersion:7 }); }); localStorage.removeItem("persona.v4.schemaRepair.v1"); return due; } finally { db.close(); } })()');
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(seeded), "Synthetic legacy migration fixture not inserted");
  await reload(cdp);
  await waitUntil(cdp, '(document.querySelector("#view")?.innerText || "").includes("Expired snooze test reminder")', "expired-snooze Today reminder");
  const db = await snapshot(cdp);
  assert.equal(db.people.find((p) => p.id === "v4-migrate-check")?.schemaVersion, 7,
    "Retried schema repair did not persist for imported legacy record");
  assert.equal(db.followUps.find((f) => f.id === "v4-expired-snooze")?.status, "snoozed",
    "Schema repair modified the follow-up state");
  assert.equal(await cdp.evaluate('localStorage.getItem("persona.v4.schemaRepair.v1")'), "done",
    "Backfill progress marker not set after all 33 store transactions");
  await openView(cdp, "openloops");
  await waitUntil(cdp, '(document.querySelector("#view")?.innerText || "").includes("Expired snooze test reminder")',
    "expired-snooze appears in historical Open Loops");
  await cdp.evaluate('document.querySelector(\'#v4PrimaryNav [data-v4-view="followups"]\').click()');
  await waitUntil(cdp, '(document.querySelector(".page-title")?.innerText || "") === "Follow-ups"', "post-migration Follow-ups view");
  assert.equal(await cdp.evaluate('!!document.querySelector(\'[data-action="completeFollowUp"][data-arg="v4-expired-snooze"]\')'), true,
    "Expired snooze missing from actionable Follow-ups");
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

async function testV4Stage7ExternalConsent(cdp, apiRequests) {
  const requestsBefore=apiRequests.length;
  await openView(cdp,"dashboard");
  const selected=await cdp.evaluate('(() => {const s=document.querySelector("#contextPersonSelect");if(![...s.options].some(o=>o.value==="v31-person"))return false;s.value="v31-person";s.dispatchEvent(new Event("change",{bubbles:true}));return true;})()');
  assert.equal(selected,true,"Cannot select fixture person for external consent check");
  await waitUntil(cdp,'!!document.querySelector("#copQuickInput")',"compact Copilot on Today");
  await cdp.evaluate('(() => {document.querySelector("#copQuickInput").value="What did I promise?";document.querySelector(\'[data-action="askCopilotQuick"]\').click();})()');
  await waitUntil(cdp,'(document.querySelector(".copQuickOut")?.textContent||"").includes("Local analysis")',"compact Copilot runs locally with provider configured");
  assert.equal(apiRequests.length,requestsBefore,"Compact Copilot silently contacted configured external provider");

  await openView(cdp,"copilot");
  await cdp.evaluate('(() => {document.querySelector("#copInput").value="What did I promise?";document.querySelector(\'[data-action="askCopilot"]\').click();})()');
  await waitUntil(cdp,'(document.querySelector("#copOut")?.textContent||"").includes("Local analysis")',"primary Copilot stays local with provider configured");
  assert.equal(apiRequests.length,requestsBefore,"Primary Copilot silently contacted external provider");
  await cdp.evaluate('document.querySelector(\'[data-action="v4ExternalCopilotReview"]\').click()');
  await waitUntil(cdp,'!!document.querySelector("#v4s7Packet")',"preflight external context review");
  const packet=await cdp.evaluate('document.querySelector("#v4s7Packet")?.value||""');
  assert.match(packet,/"evidence"/);
  assert.ok(packet.includes("v31-person"),"Approved context must identify the selected person");
  assert.equal(apiRequests.length,requestsBefore,"Opening consent preview itself sent a request");
  await cdp.evaluate('(() => {const b=[...document.querySelectorAll("#modalRoot button")].find(x=>x.textContent.includes("Keep it local"));b?.click();})()');
  assert.equal(apiRequests.length,requestsBefore,"Declining provider consent still sent private data");
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
  await testV4Workspace(cdp);
  await testV4Stage6Planning(cdp);
  await testV4Stage7GroundedCopilot(cdp);
  await testV4Stage8EvidenceNetwork(cdp);
  await testV4Stage9MobileAccessibility(cdp);
  await testV4PeopleActivity(cdp);
  await runCoreCrudWorkflow(cdp);
  await testV4SmartCaptureAndContacts(cdp);
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
  await testV4Stage7ExternalConsent(cdp, apiRequests);
  const encryptedBefore = canonical(await snapshot(cdp));
  const encryptedText = await exportEncrypted(cdp);
  await resetUi(cdp);
  assertEmpty(await snapshot(cdp), "encrypted round-trip reset");
  assert.equal(await cdp.evaluate(`sessionStorage.getItem(${JSON.stringify(SESSION_KEY)})`), null, "Reset did not clear API key");
  await bootstrapReturningUser(cdp);
  await restoreEncrypted(cdp, encryptedText);
  assert.deepEqual(canonical(await snapshot(cdp)), encryptedBefore, "Encrypted backup -> reset -> restore changed the database");
  assert.equal(await cdp.evaluate(`sessionStorage.getItem(${JSON.stringify(SESSION_KEY)})`), null, "Encrypted restore restored API key");

  await testRejectCorruptBackup(cdp);
  await testAtomicPersonCascade(cdp);
  await testLegacyMigrationRecovery(cdp);
  await testImportedIdMarkupSafety(cdp);
  await testSevenDayAgenda(cdp);

  assert.deepEqual(runtimeErrors, [], `Runtime errors: ${runtimeErrors.join(" | ")}`);
  assert.equal(consoleMessages.some((x) => x.includes(MOCK_KEY)), false, "API key leaked to console");
  console.log(`full-browser-acceptance: PASS (${EXPECTED_STORES.length} v3.1 stores; all product routes; core CRUD/search workflow; actual local analysis isolation; JSON backup/reset/restore; browser mocked external AI; encrypted backup/reset/restore; invalid-import rejection; atomic person cascade)`);
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
