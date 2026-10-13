import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  personaV4ActivityList, personaV4PersonSummary, personaV4FilterActivity
} from "../src/domain/person-activity.mjs";
import {
  personaV4EscapeActivity, personaV4RenderActivityRows, personaV4RenderActivityShell
} from "../src/ui/person-activity.mjs";

const SAMPLE = {
  people: [{id:"p1",name:"Alex"}, {id:"p2",name:"Maya"}],
  interactions: [{id:"i1",personId:"p1",date:"2026-10-09T12:00:00",observed:"We talked about work", interpretation:"Seemed confident"},
    {id:"i2",personId:"p2",date:"2026-10-08T12:00:00",observed:"Maya called"}],
  observations: [{id:"o1",personId:"p1",date:"2026-10-10T12:00:00",content:"Kept the appointment"}],
  memories: [{id:"m1",personId:"p1",date:"2026-10-01",info:"Enjoys hiking"}],
  decisions: [{id:"d1",personId:"p1",date:"2026-10-05",question:"Should I send a message?"}],
  commitments: [{id:"c1",personId:"p1",createdAt:"2026-10-03T12:00:00",commitment:"Send the document",completed:false,expectedCompletion:"2026-10-16"},
    {id:"c2",personId:"p1",commitment:"Already finished",completed:true}],
  followUps: [{id:"f1",personId:"p1",createdAt:"2026-10-11T12:00:00",text:"Follow up",status:"active",dueDate:"2026-10-15"},
    {id:"f2",personId:"p1",text:"Done",status:"done",dueDate:"2026-10-13"}]
};

test("Stage 4: six activity categories, descending chronology, original IDs, no record writes", () => {
  const before = JSON.stringify(SAMPLE);
  const rows = personaV4ActivityList(SAMPLE, "p1");
  assert.deepEqual(new Set(rows.map(x => x.kind)), new Set(["interaction","observation","memory","decision","commitment","followUp"]));
  assert.deepEqual(rows.filter(x=>x.date).map(x=>x.date), [...rows.filter(x=>x.date).map(x=>x.date)].sort().reverse());
  assert.equal(rows[0].id,"f1");
  assert.equal(rows.some(x=>x.id==="i2"),false, "Filtered profile leaked another person's activity");
  assert.equal(rows.find(x=>x.id==="c1").due,"2026-10-16", "Future commitment due date should not be represented as the time the commitment was recorded");
  assert.equal(rows.find(x=>x.id==="i1").interpretation,"Seemed confident", "Observations and interpretations must remain separate");
  assert.equal(JSON.stringify(SAMPLE),before);
});

test("Stage 4: accurate profile summary, exclude completed work, no invented contact dates", () => {
  const s = personaV4PersonSummary(SAMPLE, "p1");
  assert.deepEqual(s, {lastInteraction:"2026-10-09",interactions:1,memories:1,openFollowUps:1,openCommitments:1,nextFollowUp:"2026-10-15"});
  const missing = personaV4PersonSummary({people:[]}, "unknown");
  assert.equal(missing.lastInteraction,"");
  assert.equal(missing.nextFollowUp,"");
});

test("Stage 4: person, type, and search filters are combined without modifying the source", () => {
  const rows = personaV4ActivityList(SAMPLE);
  assert.equal(rows.length,9);
  assert.deepEqual(personaV4FilterActivity(rows,{personId:"p2"}).map(x=>x.id),["i2"]);
  assert.deepEqual(personaV4FilterActivity(rows,{personId:"p1",kind:"memory",search:"HIKING"}).map(x=>x.id),["m1"]);
  assert.deepEqual(personaV4FilterActivity(rows,{kind:"interaction",search:"confident"}).map(x=>x.id),["i1"]);
  assert.deepEqual(personaV4FilterActivity(rows,{search:"does not exist"}),[]);
});

test("Stage 4: imported hostile names, record IDs, and text remain HTML-escaped", () => {
  const injected = 'p1" onmouseover="window.evil=true';
  const payload = '<img src=x onerror="window.evil=true">';
  const names = {people:[{id:injected,name:payload}]};
  const rows = [{id:"danger",personId:injected,kind:"memory",title:payload,date:"2026-10-12",due:"",
    interpretation:payload}];
  const rendered = personaV4RenderActivityRows(rows,names);
  const controls = personaV4RenderActivityShell(names,injected);
  assert.ok(rendered.includes("&lt;img src=x onerror="));
  assert.ok(rendered.includes("onmouseover=&quot;window.evil=true"));
  assert.ok(!rendered.includes("<img"));
  assert.ok(!controls.includes('data-person-id="'+injected+'"'));
  assert.ok(controls.includes('data-person-id="'+personaV4EscapeActivity(injected)+'"'));
});

test("Stage 4: production wiring is embedded and preserves historical renderers and controls", async () => {
  const html = await readFile(new URL("../index.html",import.meta.url),"utf8");
  const css = await readFile(new URL("../src/ui/person-activity.css",import.meta.url),"utf8");
  for (const marker of ["PERSONA_V4_PERSON_ACTIVITY_START","PERSONA_V4_PERSON_ACTIVITY_END",
    "PERSONA_V4_PERSON_ACTIVITY_CSS_START","personaV4MountPeopleActivity(v);",
    "personaV4BindPeopleActivity();","function renderPersonProfile(p)","function renderInteractions()",
    'data-action="addInteraction"']) assert.ok(html.includes(marker), "Stage 4 marker missing: "+marker);
  assert.ok(css.includes("@media(max-width:480px)"),"Small-screen adaptation missing");
  assert.ok(css.includes(":focus-visible"),"Visible keyboard focus is required");
  assert.ok(!html.includes('<script type="module" src='),"Single-file offline contract broken");
});
