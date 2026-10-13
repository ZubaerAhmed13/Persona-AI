import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {personaV4Stage9Focusable,personaV4Stage9HandleModalKey} from "../src/ui/mobile-accessibility.mjs";

test("Stage 9: modal focusables exclude disabled, hidden and inert controls",()=>{
  const original=globalThis.window;
  globalThis.window={getComputedStyle:()=>({visibility:"visible"})};
  const a={disabled:false,hidden:false,closest:()=>null,getClientRects:()=>[{}]};
  const b={hidden:true,closest:()=>null,getClientRects:()=>[{}]};
  const c={hidden:false,closest:()=>({hidden:true}),getClientRects:()=>[{}]};
  const d={hidden:false,closest:()=>null,getClientRects:()=>[]};
  try{
    const root={querySelectorAll:()=>[a,b,c,d]};
    assert.deepEqual(personaV4Stage9Focusable(root),[a]);
    assert.deepEqual(personaV4Stage9Focusable(null),[]);
  }finally{if(original===undefined)delete globalThis.window;else globalThis.window=original;}
});

test("Stage 9: Tab and Shift+Tab stay within modal, Escape closes once",()=>{
  const oldWindow=globalThis.window,oldDocument=globalThis.document;
  const focusing=[];
  const first={hidden:false,getClientRects:()=>[{}],closest:()=>null,focus(){globalThis.document.activeElement=this;focusing.push("first");}};
  const last={hidden:false,getClientRects:()=>[{}],closest:()=>null,focus(){globalThis.document.activeElement=this;focusing.push("last");}};
  const backdrop={isConnected:true,querySelectorAll:()=>[first,last],contains:e=>e===first||e===last,focus(){}};
  globalThis.window={getComputedStyle:()=>({visibility:"visible"})};
  globalThis.document={activeElement:last};
  let closed=0,prevented=0;
  const e=(key,shiftKey=false)=>({key,shiftKey,preventDefault(){prevented++},stopPropagation(){}});
  try{
    personaV4Stage9HandleModalKey(e("Tab"),backdrop,()=>closed++);
    assert.equal(globalThis.document.activeElement,first);
    personaV4Stage9HandleModalKey(e("Tab",true),backdrop,()=>closed++);
    assert.equal(globalThis.document.activeElement,last);
    personaV4Stage9HandleModalKey(e("Escape"),backdrop,()=>closed++);
    assert.equal(closed,1);
    assert.equal(prevented,3);
    assert.deepEqual(focusing,["first","last"]);
  }finally{
    if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;
    if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;
  }
});

test("Stage 9: mobile CSS provides meaningful touch targets, safe areas and reduced motion",async()=>{
 const css=await readFile(new URL("../src/ui/mobile-accessibility.css",import.meta.url),"utf8");
 for(const needle of ['max-width:720px','grid-auto-flow:column','overflow-x:auto','min-height:48px',
  'font-size:16px','safe-area-inset-bottom','prefers-reduced-motion:reduce','.v4s9-skip-link:focus-visible',
  '.modal-foot button{min-height:44px}'])assert.ok(css.includes(needle),"Missing accessibility styling: "+needle);
 assert.ok(!css.includes("@import"),"Offline styling must have no remote imports");
});

test("Stage 9: generated single-file artifact preserves historical features and modal safety",async()=>{
 const html=await readFile(new URL("../index.html",import.meta.url),"utf8");
 for(const token of ["PERSONA_V4_STAGE9_START","PERSONA_V4_STAGE9_END",
  "PERSONA_V4_STAGE9_CSS_START","personaV4Stage9EnhanceView(v);",
  "personaV4Stage9PreviousFocus","personaV4Stage9HandleModalKey(e, backdrop, closeModal)",
  "personaV4Stage9FocusRoute();","aria-labelledby","v4s9ModalTitle",
  "PERSONA_V4_STAGE8_START","PERSONA_V4_STAGE7_START","PERSONA_V4_STAGE6_START",
  "function renderPeople()","function renderRelationships()"]){
   assert.ok(html.includes(token),"Missing Stage 9 or historical source: "+token);
 }
 assert.match(html,/DB_VERSION = 5/);
 assert.match(html,/SCHEMA_VERSION = 7/);
 assert.match(html,/APP_VERSION = "3\.1\.1"/);
 assert.doesNotMatch(html,/<script[^>]*src=["']https?:/);
});
