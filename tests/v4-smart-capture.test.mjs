import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {
  personaV4NormalizeContact, personaV4PersonMatches, personaV4MentionedPeople,
  personaV4InteractionDuplicates, personaV4ParseContactCSV, personaV4ContactCSVPreview,
  personaV4SearchRecords
} from "../src/domain/smart-capture.mjs";

const people=[
  {id:"alex",name:"Alex Doe",alias:"Lex",relationshipType:"Friend"},
  {id:"ana",name:"Ana",alias:"Annie"},
  {id:"anna",name:"Anna",alias:"An"}
];

test("Stage 5: names are NFKC normalized and duplicate people are reviewed by name or alias",()=>{
  assert.equal(personaV4NormalizeContact("  ＡＬＥＸ   Doe "),"alex doe");
  assert.deepEqual(personaV4PersonMatches(" lex ",people).map(p=>p.id),["alex"]);
  assert.deepEqual(personaV4PersonMatches("ALEX  DOE",people).map(p=>p.id),["alex"]);
  assert.deepEqual(personaV4PersonMatches("Alex Doe",people,"alex"),[]);
});

test("Stage 5: whole-token person detection avoids Ann/Anna false positives and reveals ambiguity",()=>{
  assert.deepEqual(personaV4MentionedPeople("Talked with Anna",people).map(p=>p.id),["anna"]);
  assert.deepEqual(new Set(personaV4MentionedPeople("I met Ana and Anna",people).map(p=>p.id)),new Set(["ana","anna"]));
  assert.deepEqual(personaV4MentionedPeople("Met no one",people),[]);
});

test("Stage 5: exact person/date/observed-fact duplicates are warnings, not silent deduplication",()=>{
  const history=[{id:"one",personId:"alex",date:"2026-10-13T12:00",observed:"  Sent THE document. "},
    {id:"two",personId:"alex",date:"2026-10-12",observed:"Sent the document."}];
  assert.deepEqual(personaV4InteractionDuplicates("alex","sent the document","2026-10-13",history).map(p=>p.id),["one"]);
  assert.deepEqual(personaV4InteractionDuplicates("ana","sent the document","2026-10-13",history),[]);
  assert.deepEqual(personaV4InteractionDuplicates("alex","sent the document","2026-10-11",history),[]);
});

test("Stage 5: RFC4180-style CSV parsing respects quotes, newlines, BOM, headers, and malformed input",()=>{
  const text='\uFEFFFull Name,Company,Notes\n"Alex, J.",Example,"Said ""hello"" yesterday"\nAna,Other,"Two\nlines"';
  const rows=personaV4ParseContactCSV(text);
  assert.equal(rows.length,2);
  assert.equal(rows[0].person.name,"Alex, J.");
  assert.equal(rows[0].person.notes,'Said "hello" yesterday');
  assert.equal(rows[1].person.notes,"Two\nlines");
  assert.throws(()=>personaV4ParseContactCSV('Name\n"Unclosed'),/Unclosed/);
  assert.throws(()=>personaV4ParseContactCSV('Name\n'+Array(502).fill('Person').join('\n')),/500/);
});

test("Stage 5: import preview skips existing name/alias, within-file collisions, missing name",()=>{
  const rows=personaV4ParseContactCSV("Name,Organization\nAlex Doe,X\nNew Name,Y\nNew Name,Z\n,Q");
  const preview=personaV4ContactCSVPreview(rows,people);
  assert.deepEqual(preview.map(p=>p.canImport),[false,true,false,false]);
  assert.equal(preview[2].duplicateRow,3);
  assert.ok(preview[3].issues.length>0);
});

test("Stage 5: global search returns relevant records instead of 16 arbitrary matches",()=>{
  const data={people,memories:[{id:"m1",personId:"ana",info:"Enjoys hiking",date:"2026-10-12"}],
    interactions:[{id:"i1",personId:"anna",observed:"Discussed hiking next week",date:"2026-10-10"},
      {id:"i2",personId:"alex",observed:"Sent notes",date:"2026-10-09"}],
    followUps:[{id:"f1",personId:"ana",text:"Ask about exam",dueDate:"2026-10-15"}]};
  const hits=personaV4SearchRecords("hiking",data);
  assert.deepEqual(new Set(hits.map(x=>x.id)),new Set(["m1","i1"]));
  assert.equal(personaV4SearchRecords("not found",data).length,0);
  assert.equal(personaV4SearchRecords("alex doe",data)[0].id,"alex");
  assert.ok(personaV4SearchRecords("",data,{personId:"ana"}).every(x=>x.id==="ana"||x.sub==="Ana"));
});

test("Stage 5: production integration retains original data contracts and offline package",async()=>{
  const html=await readFile(new URL("../index.html",import.meta.url),"utf8");
  for (const marker of ["PERSONA_V4_SMART_CAPTURE_START","PERSONA_V4_SMART_CAPTURE_END",
     "PERSONA_V4_SMART_CAPTURE_CSS_START","personaV4MountImportControls(v);",
     'case "importContactsCSV":','function personaV4OpenUniversalCapture()',
     'function legacySearchAll(q)', 'title: "Possible duplicate person"',
     'm.bodyEl.dataset.v4DuplicateConfirmed',"personaV4SearchRecords("]) {
       assert.ok(html.includes(marker),"Stage 5 bundle missing "+marker);
     }
  assert.ok(html.includes('DB_NAME = "persona-ai";'));
  assert.ok(html.includes("PERSONA_V4_PERSON_ACTIVITY_START"));
  assert.ok(!html.includes('<script type="module" src='));
});
