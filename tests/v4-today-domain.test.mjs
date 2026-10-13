import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  personaCalendarDay, personaAddCalendarDays, personaRecordClosed,
  personaFollowUpDue, personaFollowUpOpen,
  personaSelectTodayItems, personaSelectWeekAhead
} from "../src/domain/today.mjs";
import { personaRenderWeekAheadAgenda } from "../src/ui/agenda.mjs";

const payload = {
  commitments: [
    { id: "c-old", personId: "p1", description: "Legacy field", dueDate: "2026-10-12" },
    { id: "c-next", personId: "p1", commitment: "Prepare notes", expectedCompletion: "2026-10-15" },
    { id: "c-done", personId: "p1", commitment: "Completed", completed: true, dueDate: "2026-10-15" },
    { id: "c-later", personId: "p1", commitment: "Later", dueDate: "2026-10-22" }
  ],
  followUps: [
    { id: "f-overdue", personId: "p1", text: "Write tomorrow", dueDate: "2026-10-12", status: "snoozed" },
    { id: "f-future", personId: "p1", text: "Follow up", dueDate: "2026-10-14", status: "snoozed" },
    { id: "f-no-date", personId: "p1", text: "Unscheduled" },
    { id: "f-cancelled", personId: "p1", text: "Cancelled", dueDate: "2026-10-14", status: "cancelled" },
    { id: "f-bad-date", personId: "p1", text: "Invalid", dueDate: "2026-02-31" }
  ],
  predictions: [
    { id: "p-open", personId: "p1", prediction: "Outcome pending", outcome: "pending", date: "2026-10-11" },
    { id: "p-done", personId: "p1", prediction: "Already resolved", outcome: "correct" }
  ],
  memories: [
    { id: "m-next", personId: "p1", text: "Remember appointment", reminderDate: "2026-10-17" },
    { id: "m-today", personId: "p1", info: "Remember today", reminderDate: "2026-10-13" },
    { id: "m-archive", personId: "p1", info: "Archived", reminderDate: "2026-10-17", status: "archived" }
  ]
};

test("calendar operations preserve local date semantics, leap days and invalid dates", () => {
  assert.equal(personaCalendarDay("2026-10-13T22:44:00.000Z"), "2026-10-13");
  assert.equal(personaCalendarDay("2026-02-31"), "");
  assert.equal(personaCalendarDay("not a date"), "");
  assert.equal(personaAddCalendarDays("2024-02-28", 1), "2024-02-29");
  assert.equal(personaAddCalendarDays("2026-10-31", 1), "2026-11-01");
  assert.equal(personaAddCalendarDays("2026-03-28", 7), "2026-04-04");
  assert.equal(personaAddCalendarDays("2026-10-13", 1.5), "");
});

test("status selectors distinguish expired snoozes, planned future tasks and closed records", () => {
  assert.equal(personaRecordClosed({ status: "cancelled" }), true);
  assert.equal(personaFollowUpDue({ status: "snoozed", dueDate: "2026-10-12" }, "2026-10-13"), true);
  assert.equal(personaFollowUpOpen({ status: "snoozed", dueDate: "2026-10-14" }, "2026-10-13"), false);
  assert.equal(personaFollowUpOpen({ status: "open", dueDate: "2026-10-14" }, "2026-10-13"), true);
  assert.equal(personaFollowUpDue({ status: "done" }, "2026-10-13"), false);
});

test("Today selector is read-only and keeps historical dueDate records visible", () => {
  const source = structuredClone(payload);
  const now = "2026-10-13T13:00:00.000Z";
  const rows = personaSelectTodayItems(source, "2026-10-13", now);
  assert.deepEqual(rows.map(r=>r.id).sort(), ["c-old","f-overdue","f-no-date","f-bad-date","p-open","m-today"].sort());
  assert.equal(rows.find(r=>r.id==="c-old").overdue, true);
  assert.equal(rows.find(r=>r.id==="c-old").text, "Legacy field");
  assert.equal(rows.find(r=>r.id==="m-today").text, "Remember today");
  assert.equal(rows.find(r=>r.id==="f-no-date").due, now);
  assert.deepEqual(source, payload, "Read-only selector mutated its input");
});

test("seven-day view excludes today, expired, too-far, cancelled and archived entries", () => {
  const rows=personaSelectWeekAhead(payload, "2026-10-13");
  assert.deepEqual(rows.map(r=>r.id), ["f-future","c-next","m-next"]);
  assert.equal(personaSelectWeekAhead(payload, "2026-10-13", 0).length, 0);
  assert.equal(personaSelectWeekAhead(payload, "invalid").length, 0);
});

test("agenda HTML includes working historical actions and escapes untrusted labels and IDs", () => {
  const originalName = globalThis.personName, originalEscape = globalThis.esc2;
  globalThis.personName=(id)=>id === "p1" ? "Person & Friend" : "Unknown";
  globalThis.esc2=(v)=>String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  try {
    const html=personaRenderWeekAheadAgenda({
      followUps:[{id:'id" onmouseover="alert(1)',personId:"p1",text:"<img src=x>",dueDate:"2026-10-14"}]
    }, "2026-10-13");
    assert.match(html,/Coming up/);
    assert.match(html,/data-action="completeFollowUp"/);
    assert.match(html,/data-goto="followups"/);
    assert.match(html,/&lt;img src=x&gt;/);
    assert.match(html,/Person &amp; Friend/);
    assert.match(html,/data-arg="id&quot;/);
    assert.doesNotMatch(html,/<img /);
    assert.doesNotMatch(html,/data-arg="id" onmouseover/);
  } finally {
    if(originalName===undefined)delete globalThis.personName;else globalThis.personName=originalName;
    if(originalEscape===undefined)delete globalThis.esc2;else globalThis.esc2=originalEscape;
  }
});

test("single-file production includes domain, upcoming agenda and keeps original core architecture",async()=>{
  const html=await readFile(new URL("../index.html",import.meta.url),"utf8");
  const css=await readFile(new URL("../src/ui/workspace.css",import.meta.url),"utf8");
  assert.match(html,/PERSONA_V4_TODAY_DOMAIN_START/);
  assert.match(html,/PERSONA_V4_WEEK_AGENDA_START/);
  assert.match(html,/return personaSelectTodayItems\(getState\(\)\.data, todayLocal\(\), new Date\(\)\.toISOString\(\)\)/);
  assert.match(html,/personaRenderWeekAheadAgenda\(s\.data, todayLocal\(\)\)/);
  assert.match(css,/persona-agenda-row/);
  assert.match(css,/@media \(max-width: 720px\)/);
  assert.match(html,/DB_VERSION = 5/);
  assert.match(html,/APP_VERSION = "3\.1\.1"/);
});
