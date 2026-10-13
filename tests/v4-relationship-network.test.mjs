import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {personaV4Stage8Records,personaV4Stage8Network,personaV4Stage8EvidenceCoverage,personaV4Stage8DecisionPreview} from "../src/domain/relationship-network.mjs";
import {personaV4Stage8Escape,personaV4Stage8Graph,personaV4Stage8NetworkHTML,personaV4Stage8EvidenceRow} from "../src/ui/relationship-network.mjs";

const data={
  people:[{id:"a",name:"Alex",relationshipType:"Colleague"},{id:"b",name:"Bea",relationshipType:"Friend"}],
  interactions:[
    {id:"i1",personId:"a",date:"2026-10-11",observed:"Reviewed the project"},
    {id:"i2",personId:"a",date:"2026-10-12",observed:"Reviewed the report"},
    {id:"i3",personId:"b",date:"2026-08-01",observed:"Met for coffee"}
  ],
  observations:[{id:"o1",personId:"a",date:"2026-10-13",observedBehavior:"Asked a clarifying question",interpretation:"Seemed confident"}],
  memories:[{id:"m1",personId:"b",text:"Enjoys hiking",date:"2026-09-02"}],
  decisions:[{id:"d1",personId:"a",question:"Should we change the plan?",date:"2026-10-03"}],
  followUps:[{id:"f1",personId:"a",text:"Send report tomorrow",dueDate:"2026-10-14",createdAt:"2026-10-13"}]
};

test("Stage 8 network uses only first-party person records and interaction counts, never person-to-person ties",()=>{
  const before=structuredClone(data);
  const net=personaV4Stage8Network(data);
  assert.equal(net.kind,"recorded-user-contact-network");
  assert.equal(net.nodes.length,2);
  assert.equal(net.nodes.find(n=>n.id==="a").interactions,2);
  assert.equal(net.nodes.find(n=>n.id==="b").interactions,1);
  assert.equal(net.nodes.find(n=>n.id==="a").lastInteraction,"2026-10-12");
  assert.equal(net.interactionCount,3);
  assert.deepEqual(personaV4Stage8Network(data,"Colleague").nodes.map(n=>n.id),["a"]);
  assert.ok(!net.links,"No invented person-to-person edges or relationship-strength scores permitted");
  assert.deepEqual(data,before);
});

test("Stage 8 source records preserve original IDs and separate interpretations",()=>{
  const rows=personaV4Stage8Records(data,"a");
  assert.ok(rows.some(r=>r.id==="o1"&&r.text==="Asked a clarifying question"));
  assert.equal(rows.every(r=>r.personId==="a"),true);
  assert.ok(!JSON.stringify(rows).includes("Seemed confident"),"Interpretation must not be cited as an observation");
  assert.equal(personaV4Stage8Records(data,"missing").length,0);
  assert.equal(rows.find(r=>r.id==="f1").date,"2026-10-13","Do not use due date as record creation date");
});

test("Stage 8 evidence coverage counts dated records without inventing a personal metric",()=>{
  const cover=personaV4Stage8EvidenceCoverage(data,"a","2026-10-13");
  assert.equal(cover.total,5);
  assert.equal(cover.recent,5);
  assert.equal(cover.undated,0);
  assert.equal(cover.byType.interactions,2);
  assert.match(cover.note,/not a personal trait/);
});

test("Stage 8 Decision Lab preview is scoped, cautious for irreversible choices and non-mutating",()=>{
  const before=structuredClone(data);
  const p=personaV4Stage8DecisionPreview(data,"a","Should we change the project plan?","High","Irreversible");
  assert.equal(p.ok,true);
  assert.ok(p.records.length>0&&p.records.every(x=>x.personId==="a"));
  assert.ok(p.cautions.some(x=>/hard-to-reverse/i.test(x)));
  assert.match(p.note,/does not recommend/);
  assert.equal(personaV4Stage8DecisionPreview(data,"none","Project?","Low","Easy").ok,false);
  assert.equal(personaV4Stage8DecisionPreview(data,"a","  ","Low","Easy").ok,false);
  assert.deepEqual(data,before);
});

test("Stage 8 SVG and record buttons escape malicious names and IDs",()=>{
  const attack='<img src=x onerror="evil()">';
  const tricky='contact" onmouseover="evil()';
  const html=personaV4Stage8NetworkHTML({
    people:[{id:tricky,name:attack,relationshipType:attack}],
    interactions:[{id:"one",personId:tricky,date:"2026-10-01",observed:attack}]
  },"",tricky);
  assert.ok(html.includes("&lt;img"));
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes('data-arg="contact" onmouseover='));
  assert.ok(html.includes("role=\"button\" tabindex=\"0\""));
  assert.ok(!personaV4Stage8Graph({nodes:[]}).includes("<foreignObject"));
  assert.ok(personaV4Stage8Escape("A&B").includes("&amp;"));
  assert.ok(!personaV4Stage8EvidenceRow({id:"x",store:"interactions",personId:"a",date:"",text:attack}).includes("<img"));
});

test("Stage 8 package remains an offline self-contained artifact with old data/view contracts",async()=>{
  const html=await readFile(new URL("../index.html",import.meta.url),"utf8");
  for(const token of ["PERSONA_V4_STAGE8_START","PERSONA_V4_STAGE8_END","PERSONA_V4_STAGE8_CSS_START",
    "personaV4Stage8Mount(v);",'case "v4NetworkSelect":','case "v4NetworkSource":',
    'case "v4DecisionEvidence":',"PERSONA_V4_STAGE7_START","PERSONA_V4_STAGE6_START",
    "function renderDecisionLab()","function renderRelationships()","function renderPatterns()"]) {
     assert.ok(html.includes(token),"Missing Stage 8 feature or historical contract: "+token);
  }
  assert.match(html,/DB_VERSION = 5/);
  assert.match(html,/SCHEMA_VERSION = 7/);
  assert.match(html,/APP_VERSION = "3\.1\.1"/);
  assert.doesNotMatch(html,/<script[^>]+src=["']https?:/);
});
