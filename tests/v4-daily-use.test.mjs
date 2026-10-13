import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {performance} from "node:perf_hooks";
import {personaV4uxDirectory} from "../src/domain/daily-use.mjs";
import {personaV4uxCard} from "../src/ui/daily-use.mjs";

const people=[
 {id:"a",name:"Anna",alias:"Ann",organization:"University",relationshipType:"Study"},
 {id:"b",name:"Bea",organization:"Picnic",relationshipType:"Work"},
 {id:"c",name:"Charlie",alias:"CJ",organization:"University",relationshipType:"Friend"}
];
const interactions=[{id:"i1",personId:"b",date:"2026-10-13"},{id:"i2",personId:"c",date:"2026-10-12"},{id:"i3",personId:"a",date:"2026-10-11"}];

test("Daily UX: directory filters by human-readable fields without mutating people",()=>{
 const data=structuredClone(people);
 assert.deepEqual(personaV4uxDirectory(people,interactions,"ann").items.map(p=>p.id),["a"]);
 assert.deepEqual(personaV4uxDirectory(people,interactions,"university").items.map(p=>p.id),["a","c"]);
 assert.deepEqual(personaV4uxDirectory(people,interactions,"CJ").items.map(p=>p.id),["c"]);
 assert.deepEqual(personaV4uxDirectory(people,interactions,"unknown").items,[]);
 assert.deepEqual(people,data);
});

test("Daily UX: recent ordering uses recorded activity dates, not fabricated quality scores",()=>{
 const result=personaV4uxDirectory(people,interactions,"","recent",2);
 assert.deepEqual(result.items.map(p=>p.id),["b","c"]);
 assert.equal(result.total,3);
 assert.equal(result.matched,3);
 assert.equal(result.shown,2);
 assert.equal(result.more,true);
 assert.equal(Object.hasOwn(result.items[0],"score"),false);
});

test("Daily UX: bounded paging never renders more than 400 People cards",()=>{
 const large=Array.from({length:1250},(_,i)=>({id:"id"+i,name:"Person "+String(i).padStart(4,"0")}));
 assert.equal(personaV4uxDirectory(large,[],"","name",36).items.length,36);
 assert.equal(personaV4uxDirectory(large,[],"","name",73).items.length,73);
 assert.equal(personaV4uxDirectory(large,[],"","name",5000).items.length,400);
 assert.equal(personaV4uxDirectory(large,[],"missing","name",36).shown,0);
});

test("Daily UX: 2,000-person/12,000-interaction selection stays within a generous CI budget",()=>{
 const big=Array.from({length:2000},(_,i)=>({id:"p"+i,name:"Contact "+i,relationshipType:"Colleague"}));
 const history=Array.from({length:12000},(_,i)=>({personId:"p"+(i%2000),date:"2026-10-"+String(1+i%25).padStart(2,"0")}));
 const start=performance.now();
 const sorted=personaV4uxDirectory(big,history,"contact","recent",36);
 const elapsed=performance.now()-start;
 assert.equal(sorted.matched,2000);
 assert.equal(sorted.items.length,36);
 assert.ok(elapsed<2000,"Directory selector should complete within 2s on CI; measured "+elapsed.toFixed(1)+"ms");
});

test("Daily UX: contact cards preserve historic lookup contract and HTML escaping",()=>{
 const old={colorFor:globalThis.colorFor,initials:globalThis.initials,esc2:globalThis.esc2};
 globalThis.colorFor=()=>"#7472cb";
 globalThis.initials=x=>String(x).slice(0,2);
 globalThis.esc2=x=>String(x??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
 try{
   const card=personaV4uxCard({id:'id" onmouseover="bad()',name:"<script>alert('x')</script>",alias:"<a>"});
   assert.ok(card.includes('class="card person-card v4ux-person-card"'));
   assert.ok(card.includes("data-action=\"viewPerson\""));
   assert.ok(card.includes("data-action=\"quickCapture\""));
   assert.ok(card.includes("person-name"));
   assert.ok(card.includes("&lt;script&gt;"));
   assert.ok(!card.includes("<script>"));
   assert.ok(!card.includes('data-arg="id" onmouseover'));
   assert.ok(!card.includes("Reliability"));
 }finally{for(const [k,v] of Object.entries(old))if(v===undefined)delete globalThis[k];else globalThis[k]=v;}
});

test("Daily UX: the compiled offline app retains all original routes and newer modules",async()=>{
 const html=await readFile(new URL("../index.html",import.meta.url),"utf8");
 for(const token of [
  "PERSONA_V4_DAILY_UX_START","PERSONA_V4_DAILY_UX_END","PERSONA_V4_DAILY_UX_CSS_START",
  "personaV4uxEnhance(v);","personaV4uxBindDirectory();",'case "v4uxPeopleMore":',
  "personaV4uxInitSearchKeyboard();","PERSONA_V4_STAGE9_START","PERSONA_V4_STAGE7_START",
  "PERSONA_V4_SMART_CAPTURE_START","function renderPersonProfile(p)"
 ])assert.ok(html.includes(token),"Missing daily UX or historic marker: "+token);
 assert.match(html,/DB_VERSION = 5/);
 assert.match(html,/SCHEMA_VERSION = 7/);
 assert.match(html,/APP_VERSION = "3\.1\.1"/);
});
