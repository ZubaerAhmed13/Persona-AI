import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const html = await readFile(resolve(root, "index.html"));
const fixture = JSON.parse(await readFile(resolve(root, "tests/fixtures/v3.1-full-backup.json"), "utf8"));
const SETTINGS_KEY = "persona.settings.v1";
const PERSON_ID = "v31-person";
const MARK = "FEATURE_WORKFLOW_4b91";
const sleep = (ms) => new Promise((resolve2) => setTimeout(resolve2, ms));

function findChrome() {
  for (const candidate of [process.env.CHROME_BIN, "google-chrome", "google-chrome-stable", "chromium", "chromium-browser"].filter(Boolean)) {
    const found = spawnSync("bash", ["-lc", `command -v ${JSON.stringify(candidate)} || true`], { encoding: "utf8" }).stdout.trim();
    if (found) return found;
  }
  throw new Error("Chrome/Chromium is required for feature workflow acceptance");
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
  for (let i = 0; i < 240; i++) {
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

async function reload(cdp) {
  const before = await cdp.evaluate("performance.timeOrigin");
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitUntil(cdp, `document.readyState === 'complete' && performance.timeOrigin !== ${JSON.stringify(before)}`, "reload", 20000);
  await sleep(300);
}

async function setField(cdp, selector, value, { optional = false } = {}) {
  const result = await cdp.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.value = ${JSON.stringify(value)};
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  if (!optional) assert.equal(result, true, `Field not found: ${selector}`);
  return result;
}

async function clickSelector(cdp, selector, { optional = false } = {}) {
  const result = await cdp.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.click();
    return true;
  })()`);
  if (!optional) assert.equal(result, true, `Control not found: ${selector}`);
  return result;
}

async function clickModalPrimary(cdp) {
  const label = await cdp.evaluate(`(() => {
    const root = document.querySelector("#modalRoot");
    if (!root) return null;
    const buttons = Array.from(root.querySelectorAll("button.btn-primary")).filter((b) => !b.disabled);
    const el = buttons.at(-1);
    if (!el) return null;
    const text = (el.textContent || "").trim();
    el.click();
    return text;
  })()`);
  assert.ok(label, "No enabled primary modal action found");
  return label;
}

async function clickModalText(cdp, text) {
  const ok = await cdp.evaluate(`(() => {
    const wanted = ${JSON.stringify(text.toLowerCase())};
    const root = document.querySelector("#modalRoot");
    if (!root) return false;
    const el = Array.from(root.querySelectorAll("button,a,[role='button']")).find((x) => (x.textContent || "").trim().toLowerCase() === wanted);
    if (!el) return false;
    el.click();
    return true;
  })()`);
  assert.equal(ok, true, `Modal control not found: ${text}`);
}

async function openView(cdp, view) {
  const ok = await cdp.evaluate(`(() => {
    const all = Array.from(document.querySelectorAll('[data-view="${view}"]'));
    const el = all.find((x) => x.classList.contains("nav-item")) || all[0];
    if (!el) return false;
    el.click();
    return true;
  })()`);
  assert.equal(ok, true, `View not found: ${view}`);
  await waitUntil(cdp, `!!document.querySelector(".page-title")`, `${view} render`);
  await sleep(120);
}

async function availableViews(cdp) {
  return cdp.evaluate(`Array.from(new Set(Array.from(document.querySelectorAll(".nav-item[data-view]")).map(x => x.getAttribute("data-view")).filter(Boolean)))`);
}

async function clickActionAnywhere(cdp, action, arg = null) {
  const selector = arg == null ? `[data-action="${action}"]` : `[data-action="${action}"][data-arg="${arg}"]`;
  const clickCurrent = async () => cdp.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.click();
    return true;
  })()`);
  if (await clickCurrent()) return "current";
  for (const view of await availableViews(cdp)) {
    await openView(cdp, view);
    if (await clickCurrent()) return view;
    const tabs = await cdp.evaluate(`Array.from(document.querySelectorAll("[data-ctab]")).map(x => x.getAttribute("data-ctab"))`);
    for (const tab of tabs) {
      await clickSelector(cdp, `[data-ctab="${tab}"]`);
      await sleep(80);
      if (await clickCurrent()) return `${view}:${tab}`;
    }
  }
  throw new Error(`Action not found in any application view: ${action}${arg ? `(${arg})` : ""}`);
}

async function storeAll(cdp, store) {
  return cdp.evaluate(`(async () => {
    const db = await new Promise((resolve2, reject) => {
      const r = indexedDB.open("persona-ai");
      r.onsuccess = () => resolve2(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      return await new Promise((resolve2, reject) => {
        const r = db.transaction(${JSON.stringify(store)}, "readonly").objectStore(${JSON.stringify(store)}).getAll();
        r.onsuccess = () => resolve2(r.result || []);
        r.onerror = () => reject(r.error);
      });
    } finally { db.close(); }
  })()`);
}

async function waitRecord(cdp, store, predicate, label, timeoutMs = 12000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const rows = await storeAll(cdp, store);
    const found = rows.find(predicate);
    if (found) return found;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function waitRecordGone(cdp, store, id, label) {
  const end = Date.now() + 12000;
  while (Date.now() < end) {
    if (!(await storeAll(cdp, store)).some((x) => x.id === id)) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function seedFixture(cdp) {
  const data = fixture.data;
  await cdp.evaluate(`(async () => {
    const data = ${JSON.stringify(data)};
    const db = await new Promise((resolve2, reject) => {
      const r = indexedDB.open("persona-ai");
      r.onsuccess = () => resolve2(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      for (const [store, rows] of Object.entries(data)) {
        await new Promise((resolve2, reject) => {
          const tx = db.transaction(store, "readwrite");
          const os = tx.objectStore(store);
          os.clear();
          for (const row of rows) os.put(row);
          tx.oncomplete = () => resolve2();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error || new Error("transaction aborted"));
        });
      }
    } finally { db.close(); }
    const current = JSON.parse(localStorage.getItem(${JSON.stringify(SETTINGS_KEY)}) || "{}");
    localStorage.setItem(${JSON.stringify(SETTINGS_KEY)}, JSON.stringify({ ...current, onboardingDone: true, aiProvider: "local", aiEnabled: true }));
    return true;
  })()`);
  await reload(cdp);
  assert.ok((await storeAll(cdp, "people")).some((p) => p.id === PERSON_ID), "Fixture person missing after seed");
  await cdp.evaluate(`(() => {
    const sel = document.querySelector("#contextPersonSelect");
    if (!sel || !Array.from(sel.options).some((o) => o.value === ${JSON.stringify(PERSON_ID)})) return false;
    sel.value = ${JSON.stringify(PERSON_ID)};
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  await sleep(200);
}

async function selectTag(cdp, groupId, tag) {
  const ok = await cdp.evaluate(`(() => {
    const root = document.querySelector(${JSON.stringify(`#${groupId}`)});
    if (!root) return false;
    const el = Array.from(root.querySelectorAll("[data-tagopt]")).find(x => x.getAttribute("data-tagopt") === ${JSON.stringify(tag)});
    if (!el) return false;
    if (!el.classList.contains("on")) el.click();
    return true;
  })()`);
  assert.equal(ok, true, `Tag not found: ${groupId}/${tag}`);
}

async function createInteraction(cdp, marker, { keep = true, oneToOne = false } = {}) {
  await clickActionAnywhere(cdp, "addInteraction");
  await waitUntil(cdp, `!!document.querySelector("#if_obs")`, "interaction form");
  await setField(cdp, "#if_person", PERSON_ID);
  await setField(cdp, "#if_obs", marker);
  await setField(cdp, "#if_int", "Evidence-only feature acceptance interpretation");
  await setField(cdp, "#if_date", new Date().toISOString().slice(0, 10));
  await selectTag(cdp, "if_tags", "Followed through");
  if (oneToOne) await selectTag(cdp, "if_ctx", "One-to-one");
  await clickModalPrimary(cdp);
  const rec = await waitRecord(cdp, "interactions", (x) => x.observed === marker, `interaction ${marker}`);
  if (!keep) {
    await clickActionAnywhere(cdp, "deleteInteraction", rec.id);
    await waitUntil(cdp, `!!document.querySelector("#modalRoot")`, "interaction delete confirmation");
    await clickModalText(cdp, "Delete");
    await waitRecordGone(cdp, "interactions", rec.id, "interaction deletion");
  }
  return rec;
}

async function createFollowUp(cdp, marker) {
  await clickActionAnywhere(cdp, "addFollowUp");
  await waitUntil(cdp, `!!document.querySelector("#fu_text")`, "follow-up form");
  await setField(cdp, "#fu_person", PERSON_ID);
  await setField(cdp, "#fu_text", marker);
  await setField(cdp, "#fu_due", new Date().toISOString().slice(0, 10));
  await clickModalPrimary(cdp);
  return waitRecord(cdp, "followUps", (x) => x.text === marker, `follow-up ${marker}`);
}

const server = createServer((req, res) => {
  const path = (req.url || "/").split("?")[0];
  if (path === "/" || path === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(html);
  } else if (path === "/favicon.ico") {
    res.writeHead(204);
    res.end();
  } else {
    res.writeHead(404);
    res.end("not found");
  }
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const appUrl = `http://127.0.0.1:${server.address().port}/`;

const chrome = findChrome();
const profileDir = await mkdtemp(join(tmpdir(), "persona-feature-workflows-"));
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
const runtimeErrors = [];
try {
  const ws = await waitForDevTools(profileDir, chromeProcess);
  cdp = new CDP(ws);
  await cdp.connect();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  cdp.on("Runtime.exceptionThrown", (p) => runtimeErrors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || "Uncaught exception"));
  await cdp.send("Page.navigate", { url: appUrl });
  await waitUntil(cdp, `document.readyState === "complete" && !!document.body`, "application load", 20000);
  await seedFixture(cdp);

  // Interaction: create -> edit -> delete.
  const interactionMarker = `${MARK}_interaction`;
  const interaction = await createInteraction(cdp, interactionMarker);
  await clickActionAnywhere(cdp, "editInteraction", interaction.id);
  await waitUntil(cdp, `!!document.querySelector("#if_obs")`, "interaction edit form");
  await setField(cdp, "#if_obs", `${interactionMarker}_edited`);
  await clickModalPrimary(cdp);
  await waitRecord(cdp, "interactions", (x) => x.id === interaction.id && x.observed === `${interactionMarker}_edited`, "interaction edit persistence");
  await clickActionAnywhere(cdp, "deleteInteraction", interaction.id);
  await clickModalText(cdp, "Delete");
  await waitRecordGone(cdp, "interactions", interaction.id, "interaction deletion");

  // Memory: create -> confirm -> complete -> delete.
  const memoryMarker = `${MARK}_memory`;
  await clickActionAnywhere(cdp, "addMemory");
  await waitUntil(cdp, `!!document.querySelector("#mm_info")`, "memory form");
  await setField(cdp, "#mm_person", PERSON_ID);
  await setField(cdp, "#mm_info", memoryMarker);
  await clickModalPrimary(cdp);
  const memory = await waitRecord(cdp, "memories", (x) => x.info === memoryMarker, "memory creation");
  await clickActionAnywhere(cdp, "confirmMemory", memory.id);
  await waitRecord(cdp, "memories", (x) => x.id === memory.id && !!x.lastConfirmed, "memory confirmation");
  await clickActionAnywhere(cdp, "completeMemory", memory.id);
  await waitRecord(cdp, "memories", (x) => x.id === memory.id && x.status === "done", "memory completion");
  await clickActionAnywhere(cdp, "deleteMemory", memory.id);
  await clickModalText(cdp, "Delete");
  await waitRecordGone(cdp, "memories", memory.id, "memory deletion");

  // Commitment: create -> complete -> delete from completed tab.
  const commitmentMarker = `${MARK}_commitment`;
  await clickActionAnywhere(cdp, "addCommitment");
  await waitUntil(cdp, `!!document.querySelector("#cm_text")`, "commitment form");
  await setField(cdp, "#cm_person", PERSON_ID);
  await setField(cdp, "#cm_text", commitmentMarker);
  await setField(cdp, "#cm_exp", "2026-09-01");
  await clickModalPrimary(cdp);
  const commitment = await waitRecord(cdp, "commitments", (x) => x.commitment === commitmentMarker, "commitment creation");
  await clickActionAnywhere(cdp, "completeCommitment", commitment.id);
  await waitRecord(cdp, "commitments", (x) => x.id === commitment.id && x.completed === true && x.outcome === "Completed", "commitment completion");
  await clickActionAnywhere(cdp, "deleteCommitment", commitment.id);
  await clickModalText(cdp, "Delete");
  await waitRecordGone(cdp, "commitments", commitment.id, "commitment deletion");

  // Prediction: create -> outcome -> delete.
  const predictionMarker = `${MARK}_prediction`;
  await clickActionAnywhere(cdp, "addPrediction");
  await waitUntil(cdp, `!!document.querySelector("#pd_text")`, "prediction form");
  await setField(cdp, "#pd_person", PERSON_ID);
  await setField(cdp, "#pd_text", predictionMarker);
  await setField(cdp, "#pd_conf", "72");
  await setField(cdp, "#pd_time", "within 7 days");
  await clickModalPrimary(cdp);
  const prediction = await waitRecord(cdp, "predictions", (x) => x.predictionText === predictionMarker, "prediction creation");
  await clickActionAnywhere(cdp, "outcomePrediction", prediction.id);
  await waitUntil(cdp, `!!document.querySelector("#oc_val")`, "prediction outcome form");
  await setField(cdp, "#oc_val", "correct");
  await setField(cdp, "#oc_notes", `${MARK}_prediction_outcome`);
  await clickModalPrimary(cdp);
  await waitRecord(cdp, "predictions", (x) => x.id === prediction.id && x.outcome === "correct", "prediction outcome");
  await clickActionAnywhere(cdp, "deletePrediction", prediction.id);
  await clickModalText(cdp, "Delete");
  await waitRecordGone(cdp, "predictions", prediction.id, "prediction deletion");

  // Follow-up: create -> complete, and independent create -> snooze.
  const followDone = await createFollowUp(cdp, `${MARK}_follow_done`);
  await clickActionAnywhere(cdp, "completeFollowUp", followDone.id);
  await waitRecord(cdp, "followUps", (x) => x.id === followDone.id && x.status === "done", "follow-up completion");
  const followSnooze = await createFollowUp(cdp, `${MARK}_follow_snooze`);
  await clickActionAnywhere(cdp, "snoozeFollowUp", followSnooze.id);
  await waitRecord(cdp, "followUps", (x) => x.id === followSnooze.id && x.status === "snoozed", "follow-up snooze");

  // Reviews: real generated modal execution + persistence.
  for (const [action, store, label] of [
    ["runWeeklyReview", "weeklyReviews", "weekly review"],
    ["runMonthlyReview", "monthlyReviews", "monthly review"]
  ]) {
    const before = (await storeAll(cdp, store)).length;
    await clickActionAnywhere(cdp, action);
    await waitUntil(cdp, `!!document.querySelector("#modalRoot")`, `${label} modal`);
    await sleep(250);
    await clickModalPrimary(cdp);
    await waitRecord(cdp, store, (_x, _i, rows) => rows.length > before, `${label} persistence`);
    assert.ok((await storeAll(cdp, store)).length > before, `${label} was not persisted`);
  }

  // Relationship goal: create -> delete.
  const goalsBefore = new Set((await storeAll(cdp, "relationshipGoals")).map((x) => x.id));
  await clickActionAnywhere(cdp, "addRelationshipGoal");
  await waitUntil(cdp, `!!document.querySelector("#rg_person")`, "relationship goal form");
  await setField(cdp, "#rg_person", PERSON_ID);
  await setField(cdp, "#rg_notes", `${MARK}_goal`);
  await clickModalPrimary(cdp);
  const goal = await waitRecord(cdp, "relationshipGoals", (x) => !goalsBefore.has(x.id) && x.notes === `${MARK}_goal`, "relationship goal creation");
  await clickActionAnywhere(cdp, "deleteRelationshipGoal", goal.id);
  await clickModalText(cdp, "Delete");
  await waitRecordGone(cdp, "relationshipGoals", goal.id, "relationship goal deletion");

  // Experiment: create -> resolve -> delete.
  const experimentMarker = `${MARK}_experiment`;
  await clickActionAnywhere(cdp, "addExperiment");
  await waitUntil(cdp, `!!document.querySelector("#ex_question")`, "experiment form");
  await setField(cdp, "#ex_person", PERSON_ID);
  await setField(cdp, "#ex_question", experimentMarker);
  await setField(cdp, "#ex_hyp", "Normal follow-through will remain observable.");
  await setField(cdp, "#ex_evidence", "A normal interaction with a clear outcome.");
  await setField(cdp, "#ex_change", "A different observed outcome.");
  await clickModalPrimary(cdp);
  const experiment = await waitRecord(cdp, "experiments", (x) => x.question === experimentMarker, "experiment creation");
  await clickActionAnywhere(cdp, "experimentOutcome", experiment.id);
  await waitUntil(cdp, `!!document.querySelector("#eo_result")`, "experiment outcome form");
  await setField(cdp, "#eo_result", "confirmed");
  await setField(cdp, "#eo_notes", `${MARK}_experiment_outcome`);
  await clickModalPrimary(cdp);
  await waitRecord(cdp, "experiments", (x) => x.id === experiment.id && x.status === "resolved" && x.result === "confirmed", "experiment resolution");
  await clickActionAnywhere(cdp, "deleteExperiment", experiment.id);
  await clickModalText(cdp, "Delete");
  await waitRecordGone(cdp, "experiments", experiment.id, "experiment deletion");

  // Playbook evidence update: measure derived evidence before/after three real interaction creations.
  await openView(cdp, "playbook");
  const beforeEvidence = await cdp.evaluate(`(() => {
    const el = Array.from(document.querySelectorAll(".card-title")).find(x => /Current Playbook/i.test(x.textContent || ""));
    const m = (el?.textContent || "").match(/(\\d+)\\s+evidence records/i);
    return m ? Number(m[1]) : null;
  })()`);
  assert.notEqual(beforeEvidence, null, "Playbook evidence count unavailable");

  for (let i = 1; i <= 3; i++) await createInteraction(cdp, `${MARK}_signal_${i}`, { oneToOne: true });

  await openView(cdp, "playbook");
  const afterEvidence = await cdp.evaluate(`(() => {
    const el = Array.from(document.querySelectorAll(".card-title")).find(x => /Current Playbook/i.test(x.textContent || ""));
    const m = (el?.textContent || "").match(/(\\d+)\\s+evidence records/i);
    return m ? Number(m[1]) : null;
  })()`);
  assert.equal(afterEvidence, beforeEvidence + 3, `Playbook did not update from new evidence (${beforeEvidence} -> ${afterEvidence})`);
  await clickActionAnywhere(cdp, "strategy");
  await waitUntil(cdp, `!!document.querySelector("#st_go")`, "playbook strategy modal");
  await clickSelector(cdp, "#st_go");
  await waitUntil(cdp, `(document.querySelector("#st_out")?.innerText || "").includes("Historically useful approach")`, "playbook strategy result", 15000);
  await clickModalText(cdp, "Close");

  // Situation Intelligence: real comparison execution.
  await openView(cdp, "situations");
  await setField(cdp, "#sit_person", PERSON_ID);
  await setField(cdp, "#sit_goal", "Ask for help");
  await setField(cdp, "#sit_ctx", "One-to-one");
  await setField(cdp, "#sit_type", "Help request");
  await clickSelector(cdp, "#sit_go");
  await waitUntil(cdp, `(document.querySelector("#sit_out")?.innerText || "").includes("SITUATION COMPARISON")`, "situation comparison output");
  const situationText = await cdp.evaluate(`document.querySelector("#sit_out")?.innerText || ""`);
  assert.match(situationText, /Comparable/i, "Situation comparison did not show comparable-case output");

  // Signal processing: new real interactions must produce a derived signal table.
  await openView(cdp, "signals");
  await waitUntil(cdp, `document.querySelectorAll(".data-table tbody tr").length > 0 || (document.body.innerText || "").includes("Signal Library")`, "signal processing view");
  const signalRows = await cdp.evaluate(`Array.from(document.querySelectorAll(".data-table tbody tr")).map(x => (x.innerText || "").trim()).filter(Boolean)`);
  assert.ok(signalRows.length >= 1, `Signal processing did not produce a derived signal row; body=${(await cdp.evaluate("document.body.innerText")).slice(0, 1000)}`);

  assert.deepEqual(runtimeErrors, [], `Feature workflow browser/runtime errors: ${runtimeErrors.join(" | ")}`);
  console.log("feature-workflow-acceptance: PASS (Interaction CRUD; Memory lifecycle; Commitment lifecycle; Prediction outcome; Follow-up complete/snooze; Weekly/Monthly Reviews; Relationship Goal CRUD; Experiment lifecycle; Playbook evidence update/strategy; Situation comparison; Signal processing)");
} finally {
  cdp?.close();
  const exited = chromeProcess.exitCode === null ? once(chromeProcess, "exit").catch(() => []) : Promise.resolve([]);
  if (chromeProcess.exitCode === null) chromeProcess.kill("SIGTERM");
  await Promise.race([exited, sleep(2000)]);
  if (chromeProcess.exitCode === null) chromeProcess.kill("SIGKILL");
  server.close();
  await sleep(250);
  await rm(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
}
