import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { personaV4TaskDay,personaV4TaskBuckets,personaV4WeeklyPlan,personaV4ValidateTaskDate } from "../src/domain/followup-planner.mjs";
import { personaV4Stage6RenderFollowUps } from "../src/ui/followup-planner.mjs";

const source={
  people:[{id:"p1",name:"Alex"},{id:"p2",name:"Maya"}],
  commitments:[
    {id:"old-legacy",personId:"p1",description:"Send a report",dueDate:"2026-10-12",completed:false},
    {id:"new",personId:"p1",commitment:"Review notes",expectedCompletion:"2026-10-19"},
    {id:"cancelled",personId:"p1",description:"Old",dueDate:"2026-10-10",cancelled:true}],
  followUps:[
    {id:"due",personId:"p1",text:"Call Alex",dueDate:"2026-10-13"},
    {id:"overdue",personId:"p1",text:"Return message",dueDate:"2026-10-12"},
    {id:"paused",personId:"p1",text:"Pause until October 16",dueDate:"2026-10-16",status:"snoozed"},
    {id:"future",personId:"p1",text:"Future meeting",dueDate:"2026-10-17"},
    {id:"without",personId:"p1",text:"Need date"},
    {id:"finished",personId:"p2",text:"Done",status:"done",dueDate:"2026-10-12"},
    {id:"archived",personId:"p1",text:"Old archive",status:"archived",dueDate:"2026-10-12"}],
  memories:[{id:"reminder",personId:"p1",text:"Remember birthday",reminderDate:"2026-10-14"}]
};

test("Stage 6: due date uses existing legacy commitment fields without rewriting records",()=>{
  assert.equal(personaV4TaskDay(source.commitments[0],"commitment"),"2026-10-12");
  assert.equal(personaV4TaskDay(source.commitments[1],"commitment"),"2026-10-19");
  assert.equal(personaV4TaskDay({dueDate:"2026-02-31"},"followUp"),"");
  assert.equal(personaV4ValidateTaskDate("2026-10-13"),"2026-10-13");
  assert.equal(personaV4ValidateTaskDate("2026-02-31"),"");
});
test("Stage 6: due, postponed, closed and unscheduled buckets remain mutually exclusive and read-only",()=>{
  const before=structuredClone(source);
  const x=personaV4TaskBuckets(source,"2026-10-13");
  assert.deepEqual(x.overdue.map(r=>r.id),["old-legacy","overdue"].sort((a,b)=>a.localeCompare(b))); // sorted by kind, ID
  assert.deepEqual(x.today.map(r=>r.id),["due"]);
  assert.deepEqual(x.snoozed.map(r=>r.id),["paused"]);
  assert.deepEqual(x.unscheduled.map(r=>r.id),["without"]);
  assert.ok(x.upcoming.some(r=>r.id==="new"));
  assert.ok(x.upcoming.some(r=>r.id==="reminder"));
  assert.ok(x.completed.some(r=>r.id==="finished"));
  assert.ok(x.completed.some(r=>r.id==="archived"));
  assert.ok(x.cancelled.some(r=>r.id==="cancelled"));
  assert.deepEqual(source,before);
  assert.deepEqual(personaV4TaskBuckets(source,"not a date").overdue,[]);
});
test("Stage 6: per-person context and weekly digest include upcoming memory reminders",()=>{
  const a=personaV4TaskBuckets(source,"2026-10-13","p1");
  assert.ok(!Object.values(a).flat().some(row=>row.personId==="p2"));
  const plan=personaV4WeeklyPlan(source,"2026-10-13");
  assert.equal(plan.counts.overdue,2);
  assert.equal(plan.counts.dueToday,1);
  assert.equal(plan.counts.postponed,1);
  assert.equal(plan.counts.unscheduled,1);
  assert.equal(plan.counts.nextSevenDays,3);
  assert.ok(plan.next.some(row=>row.id==="reminder"));
});
test("Stage 6: user-visible followup filters distinguish postponement and avoid untrusted HTML",()=>{
  const saved=new Map();
  for(const [name,value] of Object.entries({
    getState:()=>({data:source,contextPersonId:"all",_v4Stage6Tab:"due"}),
    todayLocal:()=> "2026-10-13",
    personName:(id)=>id==="p1"?"<Alex>":"Other",
    esc2:(v)=>String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")
  })){saved.set(name,globalThis[name]);globalThis[name]=value;}
  try {
    const html=personaV4Stage6RenderFollowUps();
    assert.match(html,/Overdue \(1\)/);
    assert.match(html,/Today \(1\)/);
    assert.match(html,/Snoozed \(1\)/);
    assert.match(html,/data-action="v4SnoozeTask"/);
    assert.match(html,/&lt;Alex&gt;/);
    assert.doesNotMatch(html,/<Alex>/);
  }finally{for(const [key,value] of saved)if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
});
test("Stage 6: generated offline artifact preserves old data/route contracts and new planner",async()=>{
  const html=await readFile(new URL("../index.html",import.meta.url),"utf8");
  for(const marker of ["PERSONA_V4_STAGE6_START","PERSONA_V4_STAGE6_END","PERSONA_V4_STAGE6_CSS_START",
    "personaV4Stage6MountPlanner(v);",'case "v4RescheduleTask":',
    'case "v4ReopenFollowUp":','case "v4SnoozeTask":',
    'function personaV4Stage6RenderFollowUps()','followups: renderPersonaV4FollowUps',
    "PERSONA_V4_SMART_CAPTURE_START","PERSONA_V4_PERSON_ACTIVITY_START"])assert.ok(html.includes(marker),"Missing Stage 6 or legacy marker: "+marker);
  assert.match(html,/DB_VERSION = 5/);
  assert.match(html,/SCHEMA_VERSION = 7/);
  assert.match(html,/APP_VERSION = "3\.1\.1"/);
  assert.doesNotMatch(html,/<script[^>]*src=["']https?:/);
});
