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

function chromeBinary() {
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
        const pending = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) pending.reject(new Error(msg.error.message || "CDP command failed")); else pending.resolve(msg.result || {});
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
  }
  async evaluate(expression) {
    const out = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description || out.exceptionDetails.text || "Browser evaluation failed");
    return out.result?.value;
  }
  close() { try { this.ws?.close(); } catch {} }
}

async function devtoolsUrl(profile, proc) {
  const file = join(profile, "DevToolsActivePort");
  let last;
  for (let i = 0; i < 240; i++) {
    if (proc.exitCode !== null) throw new Error(`Chrome exited before DevTools was ready (${proc.exitCode})`);
    try {
      const port = Number((await readFile(file, "utf8")).split(/\r?\n/)[0]);
      if (port > 0) {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`);
        if (response.ok) {
          const target = (await response.json()).find((x) => x.type === "page" && x.webSocketDebuggerUrl);
          if (target) return target.webSocketDebuggerUrl;
        }
      }
    } catch (error) { last = error; }
    await sleep(100);
  }
  throw new Error(`Chrome DevTools did not become ready: ${last?.message || "unknown error"}`);
}

async function wait(cdp, expression, label, timeoutMs = 12000) {
  const until = Date.now() + timeoutMs;
  let last;
  while (Date.now() < until) {
    try { if (await cdp.evaluate(expression)) return; } catch (error) { last = error; }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}${last ? `: ${last.message}` : ""}`);
}

async function reload(cdp) {
  const origin = await cdp.evaluate("performance.timeOrigin");
  await cdp.send("Page.reload", { ignoreCache: true });
  await wait(cdp, `document.readyState === 'complete' && performance.timeOrigin !== ${JSON.stringify(origin)}`, "reload", 20000);
  await sleep(250);
}

async function field(cdp, selector, value) {
  const ok = await cdp.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.value = ${JSON.stringify(value)};
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  assert.equal(ok, true, `Field not found: ${selector}`);
}

async function click(cdp, selector) {
  const ok = await cdp.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
  assert.equal(ok, true, `Control not found: ${selector}`);
}

async function modalPrimary(cdp) {
  const label = await cdp.evaluate(`(() => {
    const root = document.querySelector("#modalRoot");
    const el = Array.from(root?.querySelectorAll("button.btn-primary") || []).filter((x) => !x.disabled).at(-1);
    if (!el) return "";
    const label = (el.textContent || "").trim();
    el.click();
    return label;
  })()`);
  assert.ok(label, "No enabled primary modal action found");
  return label;
}

async function modalText(cdp, text) {
  const ok = await cdp.evaluate(`(() => {
    const root = document.querySelector("#modalRoot");
    const wanted = ${JSON.stringify(text.toLowerCase())};
    const el = Array.from(root?.querySelectorAll("button,a,[role='button']") || []).find((x) => (x.textContent || "").trim().toLowerCase() === wanted);
    if (!el) return false;
    el.click();
    return true;
  })()`);
  assert.equal(ok, true, `Modal action not found: ${text}`);
}

async function openView(cdp, view) {
  const ok = await cdp.evaluate(`(() => {
    const controls = Array.from(document.querySelectorAll('[data-view="${view}"]'));
    const el = controls.find((x) => x.classList.contains("nav-item")) || controls[0];
    if (!el) return false;
    el.click();
    return true;
  })()`);
  assert.equal(ok, true, `View not found: ${view}`);
  await wait(cdp, `!!document.querySelector(".page-title")`, `${view} render`);
  await sleep(100);
}

async function views(cdp) {
  return cdp.evaluate(`Array.from(new Set(Array.from(document.querySelectorAll(".nav-item[data-view]")).map(x => x.dataset.view).filter(Boolean)))`);
}

async function action(cdp, name, arg = null) {
  const selector = arg == null ? `[data-action="${name}"]` : `[data-action="${name}"][data-arg="${arg}"]`;
  const attempt = () => cdp.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
  if (await attempt()) return;
  for (const view of await views(cdp)) {
    await openView(cdp, view);
    if (await attempt()) return;
    for (const tab of await cdp.evaluate(`Array.from(document.querySelectorAll("[data-ctab]")).map(x => x.dataset.ctab)`)) {
      await click(cdp, `[data-ctab="${tab}"]`);
      await sleep(80);
      if (await attempt()) return;
    }
  }
  throw new Error(`Action not found: ${name}${arg ? `(${arg})` : ""}`);
}

async function tag(cdp, group, value) {
  const ok = await cdp.evaluate(`(() => {
    const root = document.querySelector('[data-taggroup="${group}"]');
    if (!root) return false;
    const button = Array.from(root.querySelectorAll("[data-tagopt]")).find((x) => x.dataset.tagopt === ${JSON.stringify(value)});
    if (!button) return false;
    if (!button.classList.contains("on")) button.click();
    return button.classList.contains("on");
  })()`);
  assert.equal(ok, true, `Tag unavailable in real UI: ${group}/${value}`);
}

async function all(cdp, store) {
  return cdp.evaluate(`(async () => {
    const db = await new Promise((resolve2, reject) => { const r = indexedDB.open("persona-ai"); r.onsuccess = () => resolve2(r.result); r.onerror = () => reject(r.error); });
    try {
      return await new Promise((resolve2, reject) => { const r = db.transaction(${JSON.stringify(store)}, "readonly").objectStore(${JSON.stringify(store)}).getAll(); r.onsuccess = () => resolve2(r.result || []); r.onerror = () => reject(r.error); });
    } finally { db.close(); }
  })()`);
}

async function record(cdp, store, predicate, label, timeoutMs = 12000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const rows = await all(cdp, store);
    const found = rows.find(predicate);
    if (found) return found;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function gone(cdp, store, id, label) {
  await wait(cdp, `(async () => {
    const db = await new Promise((resolve2, reject) => { const r = indexedDB.open("persona-ai"); r.onsuccess=()=>resolve2(r.result); r.onerror=()=>reject(r.error); });
    try { return await new Promise((resolve2, reject) => { const r=db.transaction(${JSON.stringify(store)},"readonly").objectStore(${JSON.stringify(store)}).get(${JSON.stringify(id)}); r.onsuccess=()=>resolve2(!r.result); r.onerror=()=>reject(r.error); }); } finally { db.close(); }
  })()`, label);
}

async function seed(cdp) {
  await cdp.evaluate(`(async () => {
    const data = ${JSON.stringify(fixture.data)};
    const db = await new Promise((resolve2, reject) => { const r=indexedDB.open("persona-ai"); r.onsuccess=()=>resolve2(r.result); r.onerror=()=>reject(r.error); });
    try {
      for (const [store, rows] of Object.entries(data)) await new Promise((resolve2, reject) => {
        const tx=db.transaction(store,"readwrite"); const os=tx.objectStore(store); os.clear(); for (const row of rows) os.put(row);
        tx.oncomplete=()=>resolve2(); tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error || new Error("seed transaction aborted"));
      });
    } finally { db.close(); }
    const current=JSON.parse(localStorage.getItem(${JSON.stringify(SETTINGS_KEY)}) || "{}");
    localStorage.setItem(${JSON.stringify(SETTINGS_KEY)}, JSON.stringify({ ...current, onboardingDone:true, aiProvider:"local", aiEnabled:true }));
  })()`);
  await reload(cdp);
  assert.ok((await all(cdp, "people")).some((x) => x.id === PERSON_ID), "Fixture person missing");
  const selected = await cdp.evaluate(`(() => { const s=document.querySelector("#contextPersonSelect"); if (!s || !Array.from(s.options).some(o=>o.value===${JSON.stringify(PERSON_ID)})) return false; s.value=${JSON.stringify(PERSON_ID)}; s.dispatchEvent(new Event("change",{bubbles:true})); return true; })()`);
  assert.equal(selected, true, "Could not select fixture person context");
  await sleep(200);
}

async function makeInteraction(cdp, text, { oneToOne = false } = {}) {
  await action(cdp, "addInteraction");
  await wait(cdp, `!!document.querySelector("#if_obs")`, "interaction form");
  await field(cdp, "#if_person", PERSON_ID);
  await field(cdp, "#if_obs", text);
  await field(cdp, "#if_int", "Feature acceptance interpretation kept separate from fact");
  await tag(cdp, "if_tags", "Followed through");
  if (oneToOne) await tag(cdp, "if_ctx", "One-to-one");
  await modalPrimary(cdp);
  return record(cdp, "interactions", (x) => x.observed === text, `interaction ${text}`);
}

async function makeMemory(cdp, text) {
  await action(cdp, "addMemory");
  await wait(cdp, `!!document.querySelector("#mm_info")`, "memory form");
  await field(cdp, "#mm_person", PERSON_ID);
  await field(cdp, "#mm_info", text);
  await modalPrimary(cdp);
  return record(cdp, "memories", (x) => x.info === text, `memory ${text}`);
}

async function makeFollowUp(cdp, text) {
  await action(cdp, "addFollowUp");
  await wait(cdp, `!!document.querySelector("#fu_text")`, "follow-up form");
  await field(cdp, "#fu_person", PERSON_ID);
  await field(cdp, "#fu_text", text);
  await field(cdp, "#fu_due", new Date().toISOString().slice(0, 10));
  await modalPrimary(cdp);
  return record(cdp, "followUps", (x) => x.text === text, `follow-up ${text}`);
}

const server = createServer((req, res) => {
  const path = (req.url || "/").split("?")[0];
  if (path === "/" || path === "/index.html") { res.writeHead(200, { "Content-Type":"text/html; charset=utf-8", "Cache-Control":"no-store" }); res.end(html); }
  else if (path === "/favicon.ico") { res.writeHead(204); res.end(); }
  else { res.writeHead(404); res.end("not found"); }
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const url = `http://127.0.0.1:${server.address().port}/`;

const profile = await mkdtemp(join(tmpdir(), "persona-features-"));
const proc = spawn(chromeBinary(), ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio:["ignore","ignore","pipe"] });
let cdp;
const runtimeErrors = [];
try {
  cdp = new CDP(await devtoolsUrl(profile, proc));
  await cdp.connect();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  cdp.on("Runtime.exceptionThrown", (p) => runtimeErrors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || "Uncaught exception"));
  await cdp.send("Page.navigate", { url });
  await wait(cdp, `document.readyState === "complete" && !!document.body`, "app load", 20000);
  await seed(cdp);

  // Interaction: create -> edit -> delete.
  const interaction = await makeInteraction(cdp, `${MARK}_interaction`);
  await action(cdp, "editInteraction", interaction.id);
  await wait(cdp, `!!document.querySelector("#if_obs")`, "interaction edit");
  await field(cdp, "#if_obs", `${MARK}_interaction_edited`);
  await modalPrimary(cdp);
  await record(cdp, "interactions", (x) => x.id === interaction.id && x.observed === `${MARK}_interaction_edited`, "interaction edit persistence");
  await action(cdp, "deleteInteraction", interaction.id);
  await modalText(cdp, "Delete");
  await gone(cdp, "interactions", interaction.id, "interaction deletion");

  // Memory: lifecycle and independent deletion.
  const memory = await makeMemory(cdp, `${MARK}_memory_lifecycle`);
  await action(cdp, "confirmMemory", memory.id);
  await record(cdp, "memories", (x) => x.id === memory.id && !!x.lastConfirmed, "memory confirmation");
  await action(cdp, "completeMemory", memory.id);
  await record(cdp, "memories", (x) => x.id === memory.id && x.status === "done", "memory completion");
  const deleteMemory = await makeMemory(cdp, `${MARK}_memory_delete`);
  await action(cdp, "deleteMemory", deleteMemory.id);
  await modalText(cdp, "Delete");
  await gone(cdp, "memories", deleteMemory.id, "memory deletion");

  // Commitment: create -> complete -> delete from completed tab.
  await action(cdp, "addCommitment");
  await wait(cdp, `!!document.querySelector("#cm_text")`, "commitment form");
  await field(cdp, "#cm_person", PERSON_ID);
  await field(cdp, "#cm_text", `${MARK}_commitment`);
  await field(cdp, "#cm_exp", "2026-09-01");
  await modalPrimary(cdp);
  const commitment = await record(cdp, "commitments", (x) => x.commitment === `${MARK}_commitment`, "commitment creation");
  await action(cdp, "completeCommitment", commitment.id);
  await record(cdp, "commitments", (x) => x.id === commitment.id && x.completed === true && x.outcome === "Completed", "commitment completion");
  await action(cdp, "deleteCommitment", commitment.id);
  await modalText(cdp, "Delete");
  await gone(cdp, "commitments", commitment.id, "commitment deletion");

  // Prediction: create -> resolve -> delete.
  await action(cdp, "addPrediction");
  await wait(cdp, `!!document.querySelector("#pd_text")`, "prediction form");
  await field(cdp, "#pd_person", PERSON_ID);
  await field(cdp, "#pd_text", `${MARK}_prediction`);
  await field(cdp, "#pd_conf", "72");
  await field(cdp, "#pd_time", "within 7 days");
  await modalPrimary(cdp);
  const prediction = await record(cdp, "predictions", (x) => x.predictionText === `${MARK}_prediction`, "prediction creation");
  await action(cdp, "outcomePrediction", prediction.id);
  await wait(cdp, `!!document.querySelector("#oc_val")`, "prediction outcome");
  await field(cdp, "#oc_val", "correct");
  await field(cdp, "#oc_notes", `${MARK}_prediction_outcome`);
  await modalPrimary(cdp);
  await record(cdp, "predictions", (x) => x.id === prediction.id && x.outcome === "correct", "prediction resolution");
  await action(cdp, "deletePrediction", prediction.id);
  await modalText(cdp, "Delete");
  await gone(cdp, "predictions", prediction.id, "prediction deletion");

  // Follow-up: complete and snooze are distinct real lifecycle paths.
  const followDone = await makeFollowUp(cdp, `${MARK}_follow_done`);
  await action(cdp, "completeFollowUp", followDone.id);
  await record(cdp, "followUps", (x) => x.id === followDone.id && x.status === "done", "follow-up completion");
  const followSnooze = await makeFollowUp(cdp, `${MARK}_follow_snooze`);
  await action(cdp, "snoozeFollowUp", followSnooze.id);
  await record(cdp, "followUps", (x) => x.id === followSnooze.id && x.status === "snoozed", "follow-up snooze");

  // Weekly and Monthly Review: execute generated review UI and prove persistence.
  for (const [name, store, label] of [["runWeeklyReview","weeklyReviews","weekly"],["runMonthlyReview","monthlyReviews","monthly"]]) {
    const before = (await all(cdp, store)).length;
    await action(cdp, name);
    await wait(cdp, `!!document.querySelector("#modalRoot")`, `${label} review modal`);
    await sleep(200);
    await modalPrimary(cdp);
    await wait(cdp, `(async()=>{const db=await new Promise((r,j)=>{const q=indexedDB.open("persona-ai");q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error)});try{return await new Promise((r,j)=>{const q=db.transaction(${JSON.stringify(store)},"readonly").objectStore(${JSON.stringify(store)}).count();q.onsuccess=()=>r(q.result>${before});q.onerror=()=>j(q.error)})}finally{db.close()}})()`, `${label} review persistence`);
  }

  // Relationship Goal: create -> delete.
  const oldGoals = new Set((await all(cdp, "relationshipGoals")).map((x) => x.id));
  await action(cdp, "addRelationshipGoal");
  await wait(cdp, `!!document.querySelector("#rg_person")`, "relationship goal form");
  await field(cdp, "#rg_person", PERSON_ID);
  await field(cdp, "#rg_notes", `${MARK}_goal`);
  await modalPrimary(cdp);
  const goal = await record(cdp, "relationshipGoals", (x) => !oldGoals.has(x.id) && x.notes === `${MARK}_goal`, "relationship goal creation");
  await action(cdp, "deleteRelationshipGoal", goal.id);
  await modalText(cdp, "Delete");
  await gone(cdp, "relationshipGoals", goal.id, "relationship goal deletion");

  // Experiment: create -> outcome/evaluation -> delete.
  await action(cdp, "addExperiment");
  await wait(cdp, `!!document.querySelector("#ex_question")`, "experiment form");
  await field(cdp, "#ex_person", PERSON_ID);
  await field(cdp, "#ex_question", `${MARK}_experiment`);
  await field(cdp, "#ex_hyp", "Normal follow-through remains observable.");
  await field(cdp, "#ex_evidence", "A comparable interaction with a clear outcome.");
  await field(cdp, "#ex_change", "A different observed result.");
  await modalPrimary(cdp);
  const experiment = await record(cdp, "experiments", (x) => x.question === `${MARK}_experiment`, "experiment creation");
  await action(cdp, "experimentOutcome", experiment.id);
  await wait(cdp, `!!document.querySelector("#eo_result")`, "experiment outcome");
  await field(cdp, "#eo_result", "confirmed");
  await field(cdp, "#eo_notes", `${MARK}_experiment_outcome`);
  await modalPrimary(cdp);
  await record(cdp, "experiments", (x) => x.id === experiment.id && x.status === "resolved" && x.result === "confirmed", "experiment resolution");
  await action(cdp, "deleteExperiment", experiment.id);
  await modalText(cdp, "Delete");
  await gone(cdp, "experiments", experiment.id, "experiment deletion");

  // Playbook update: real newly-created interactions must increase derived evidence exactly.
  await openView(cdp, "playbook");
  const playbookCount = async () => cdp.evaluate(`(() => { const el=Array.from(document.querySelectorAll(".card-title")).find(x=>/Current Playbook/i.test(x.textContent||"")); const m=(el?.textContent||"").match(/(\\d+)\\s+evidence records/i); return m?Number(m[1]):null; })()`);
  const beforePlaybook = await playbookCount();
  assert.notEqual(beforePlaybook, null, "Playbook evidence count unavailable");
  for (let i=1;i<=3;i++) await makeInteraction(cdp, `${MARK}_signal_${i}`, { oneToOne:true });
  await openView(cdp, "playbook");
  const afterPlaybook = await playbookCount();
  assert.equal(afterPlaybook, beforePlaybook + 3, `Playbook did not update from real evidence (${beforePlaybook} -> ${afterPlaybook})`);
  await action(cdp, "strategy");
  await wait(cdp, `!!document.querySelector("#st_go")`, "playbook strategy form");
  await click(cdp, "#st_go");
  await wait(cdp, `(document.querySelector("#st_out")?.innerText || "").toLowerCase().includes("historically useful approach")`, "playbook strategy result", 15000);
  await modalText(cdp, "Close");

  // Situation Intelligence: execute comparison, not just route rendering.
  await openView(cdp, "situations");
  await field(cdp, "#sit_person", PERSON_ID);
  await field(cdp, "#sit_goal", "Ask for help");
  await field(cdp, "#sit_ctx", "One-to-one");
  await field(cdp, "#sit_type", "Help request");
  await click(cdp, "#sit_go");
  await wait(cdp, `(document.querySelector("#sit_out")?.innerText || "").includes("SITUATION COMPARISON")`, "situation comparison");
  assert.match(await cdp.evaluate(`document.querySelector("#sit_out").innerText`), /Comparable/i, "Situation comparison omitted comparable evidence");

  // Signal processing: the three UI-created Followed-through records must produce a derived signal.
  await openView(cdp, "signals");
  await wait(cdp, `document.querySelectorAll(".data-table tbody tr").length > 0`, "derived signal rows");
  const signalText = await cdp.evaluate(`Array.from(document.querySelectorAll(".data-table tbody tr")).map(x=>x.innerText).join("\n")`);
  assert.match(signalText, /Prior similar follow-through/i, "Expected derived follow-through signal missing");

  assert.deepEqual(runtimeErrors, [], `Feature workflow runtime errors: ${runtimeErrors.join(" | ")}`);
  console.log("feature-workflow-acceptance: PASS (Interaction create/edit/delete; Memory confirm/complete/delete; Commitment complete/delete; Prediction outcome/delete; Follow-up complete/snooze; Weekly/Monthly Review persistence; Relationship Goal create/delete; Experiment outcome/delete; Playbook evidence update + strategy; Situation comparison; Signal processing)");
} finally {
  cdp?.close();
  const exited = proc.exitCode === null ? once(proc, "exit").catch(() => []) : Promise.resolve([]);
  if (proc.exitCode === null) proc.kill("SIGTERM");
  await Promise.race([exited, sleep(2000)]);
  if (proc.exitCode === null) proc.kill("SIGKILL");
  server.close();
  await sleep(250);
  await rm(profile, { recursive:true, force:true, maxRetries:10, retryDelay:150 });
}