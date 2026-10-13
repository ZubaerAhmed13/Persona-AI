import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {
  personaV4EvidenceRecords,personaV4ConversationBrief,personaV4LocalEvidenceAnswer,
  personaV4ExternalEvidenceReview,personaV4ValidateExternalCitations
} from "../src/domain/grounded-copilot.mjs";
import {personaV4Stage7Escape,personaV4Stage7AnswerHTML} from "../src/ui/grounded-copilot.mjs";

const db={
  people:[{id:"alice",name:"Alice"},{id:"bob",name:"Bob"}],
  interactions:[
    {id:"alice-interaction",personId:"alice",observed:"We discussed a presentation",interpretation:"They are dishonest",date:"2026-10-13"},
    {id:"bob-interaction",personId:"bob",observed:"Bob mentioned private medical details",date:"2026-10-13"}],
  memories:[
    {id:"alice-memory",personId:"alice",info:"Alice prefers morning meetings",date:"2026-10-12"}],
  commitments:[
    {id:"alice-open",personId:"alice",commitment:"Send the presentation slides",expectedCompletion:"2026-10-16",date:"2026-10-11"},
    {id:"alice-done",personId:"alice",commitment:"Already sent the slides",completed:true,date:"2026-10-02"}],
  followUps:[
    {id:"alice-follow",personId:"alice",text:"Ask about the presentation",dueDate:"2026-10-18",createdAt:"2026-10-13"}]
};

test("Stage 7 local retrieval is scoped strictly to an explicitly selected person",()=>{
  const original=structuredClone(db);
  const rows=personaV4EvidenceRecords(db,"alice","presentation");
  assert.ok(rows.some(r=>r.id==="alice-interaction"));
  assert.ok(rows.every(r=>r.personId==="alice"));
  assert.ok(!JSON.stringify(rows).includes("private medical details"));
  assert.deepEqual(personaV4EvidenceRecords(db,null,"presentation"),[]);
  assert.deepEqual(personaV4EvidenceRecords(db,"nonexistent","presentation"),[]);
  assert.deepEqual(db,original,"A read-only question must not mutate records");
});

test("Stage 7 conversation briefing distinguishes commitments, interactions and memories",()=>{
  const result=personaV4ConversationBrief(db,"alice","2026-10-13");
  assert.equal(result.name,"Alice");
  assert.equal(result.lastInteraction.id,"alice-interaction");
  assert.equal(result.openCommitments[0].id,"alice-open");
  assert.equal(result.openFollowUps[0].id,"alice-follow");
  assert.ok(result.memories.some(r=>r.id==="alice-memory"));
  assert.equal(result.nextDue.id,"alice-open");
  assert.equal(result.sources.every(r=>r.personId==="alice"),true);
});

test("Stage 7 local answers cite source IDs and never output saved interpretations as facts",()=>{
  const answer=personaV4LocalEvidenceAnswer("What did I promise?",db,"alice","2026-10-13");
  assert.deepEqual(answer.citations.map(c=>c.id),["alice-open"]);
  assert.ok(answer.answer.includes("Send the presentation slides"));
  assert.ok(!answer.answer.includes("They are dishonest"));
  assert.ok(!answer.answer.includes("Bob mentioned"));
  const missing=personaV4LocalEvidenceAnswer("Prepare a conversation",db,"missing","2026-10-13");
  assert.equal(missing.citations.length,0);
  assert.match(missing.answer,/Select a person/);
});

test("Stage 7 approved external packet is minimal, finite and excludes other people",()=>{
  const p=personaV4ExternalEvidenceReview("presentation",db,"alice");
  assert.ok(p&&p.evidence.length>0&&p.evidence.length<=6);
  assert.deepEqual(Object.keys(p).sort(),["evidence","person","question","version"]);
  assert.ok(p.evidence.every(r=>!r.personId));
  assert.ok(!JSON.stringify(p).includes("private medical details"));
  assert.ok(!JSON.stringify(p).includes("They are dishonest"));
  assert.equal(personaV4ExternalEvidenceReview("presentation",db,"bob")?.person.id,"bob");
  assert.equal(personaV4ExternalEvidenceReview("presentation",db,null),null);
});

test("Stage 7 external citations must be a subset of explicitly approved evidence IDs",()=>{
  const p=personaV4ExternalEvidenceReview("presentation",db,"alice");
  const good={answer:"The notes mention a presentation.",evidenceIds:[p.evidence[0].id]};
  assert.equal(personaV4ValidateExternalCitations(good,p).ok,true);
  assert.equal(personaV4ValidateExternalCitations({answer:"Medical details",evidenceIds:["bob-interaction"]},p).ok,false);
  assert.equal(personaV4ValidateExternalCitations({answer:"I can guarantee that Alice is a liar.",evidenceIds:[p.evidence[0].id]},p).ok,false);
  assert.equal(personaV4ValidateExternalCitations({answer:"Uncited",evidenceIds:[]},p).ok,false);
  assert.equal(personaV4ValidateExternalCitations({answer:"Uncited"},p).ok,false);
});

test("Stage 7 source-rendering escapes hostile notes and source IDs",()=>{
  const script='<img src=x onerror="window.hacked=true">';
  const id='a" onclick="evil()';
  const html=personaV4Stage7AnswerHTML({
    answer:script,kind:"local-evidence",confidence:"Low",
    citations:[{store:"interactions",id,personId:"alice",text:script,date:"2026-10-13"}]});
  assert.ok(html.includes("&lt;img"));
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("a&quot; onclick=&quot;evil()"));
  assert.ok(!html.includes('data-arg="interactions|a" onclick'));
  assert.ok(personaV4Stage7Escape("&<>").includes("&lt;"));
});

test("Stage 7 production output preserves local-first, privacy review, source references and historical modules",async()=>{
  const html=await readFile(new URL("../index.html",import.meta.url),"utf8");
  for(const marker of ["PERSONA_V4_STAGE7_START","PERSONA_V4_STAGE7_END","PERSONA_V4_STAGE7_CSS_START",
    "personaV4Stage7MountCopilot(v);","personaV4Stage7AskLocal();",
    'case "v4ExternalCopilotReview":','case "v4EvidenceSource":',
    "PERSONA_V4_STAGE6_START","PERSONA_V4_SMART_CAPTURE_START","PERSONA_V4_WORKSPACE_RUNTIME_START"]) {
      assert.ok(html.includes(marker),"Stage 7 or historical marker missing: "+marker);
  }
  assert.ok(html.includes('DB_VERSION = 5'));
  assert.ok(html.includes('SCHEMA_VERSION = 7'));
  assert.ok(html.includes('APP_VERSION = "3.1.1"'));
  assert.ok(!html.includes('<script type="module" src='));
});
