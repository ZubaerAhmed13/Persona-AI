import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

test("Stage 10: standalone Pages verification follows current certified source instead of a stale release hash",async()=>{
 const wf=await readFile(new URL("../.github/workflows/live-pages-smoke.yml",import.meta.url),"utf8");
 assert.ok(wf.includes("git hash-object index.html"));
 assert.ok(wf.includes("wc -c < index.html"));
 assert.ok(wf.includes('PERSONA_EXPECTED_BLOB_SHA=$(git hash-object index.html)'));
 assert.ok(wf.includes("if: github.event_name != 'pull_request'"),"Do not verify an undeployed PR candidate against the live website");
 assert.ok(wf.includes('node --check scripts/live-pages-smoke.mjs'),"PR must at least validate its smoke harness");
 assert.ok(!wf.includes("fc9d71ccba14d9c77a4216339e10e75d3a7c5d40"));
 assert.ok(!wf.includes("'863903'"));
});

test("Stage 10: CI enforces a repeat-build asset/compatibility gate for every certification",async()=>{
 const workflow=await readFile(new URL("../.github/workflows/hardening.yml",import.meta.url),"utf8");
 const pkg=JSON.parse(await readFile(new URL("../package.json",import.meta.url),"utf8"));
 assert.ok(workflow.includes("Stage 10 reproducible release and asset budget gate"));
 assert.ok(workflow.includes("npm run release:gate"));
 assert.ok(workflow.indexOf("npm run release:gate")<workflow.indexOf("Complete product/backup/AI browser acceptance"));
 assert.equal(pkg.scripts["release:gate"],"node scripts/release-gate.mjs");
 assert.ok(pkg.scripts.check.includes("npm run release:gate"));
});

test("Stage 10: no external startup dependencies, schema change or secret persistence were introduced",async()=>{
 const html=await readFile(new URL("../index.html",import.meta.url),"utf8");
 for(const m of ["PERSONA_V4_STAGE9_START","PERSONA_V4_STAGE8_START",
 "PERSONA_V4_STAGE7_START","PERSONA_V4_STAGE6_START",
 "PERSONA_V4_SMART_CAPTURE_START","v4s9ModalTitle",
 "SecretStore.clearApiKey();","PERSONA_HARDENING_RUNTIME_START"]){
   assert.ok(html.includes(m),"Missing established app contract: "+m);
 }
 assert.ok(html.includes('DB_VERSION = 5;'));
 assert.ok(html.includes('SCHEMA_VERSION = 7;'));
 assert.ok(html.includes('APP_VERSION = "3.1.1";'));
 assert.ok(html.includes('["__proto__", "constructor", "prototype"]'),"Deep import sanitizer must protect against prototype-mutating keys");
 assert.doesNotMatch(html,/<link[^>]+rel=["']stylesheet["'][^>]*>/i);
 assert.doesNotMatch(html,/<script[^>]*src=["']https?:/i);
});
