// Persona AI 4.0 final, source-pinned release quality gate.
// Node-only, no network, no personal records, no dependencies.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {readFile} from "node:fs/promises";
import {resolve, dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {gzipSync} from "node:zlib";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const source=resolve(root,"index.html");
const [before,contractText,pkgText]=await Promise.all([
  readFile(source),readFile(resolve(root,"tests/contracts/v3.1.1.contract.json"),"utf8"),
  readFile(resolve(root,"package.json"),"utf8")
]);
const contract=JSON.parse(contractText),pkg=JSON.parse(pkgText),html=before.toString("utf8");
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");

assert.equal(contract.storeNames.length,33,"IndexedDB compatibility contract changed");
assert.equal(contract.renderHandlers.length,34,"Legacy view contract changed");
assert.equal(contract.databaseVersion,5);
assert.equal(contract.schemaVersion,7);
assert.equal(contract.appVersion,"3.1.1");
assert.equal(pkg.version,contract.appVersion,"Backup-format compatibility version drift");
assert.ok(before.length>=850_000,"Unexpectedly small bundle, possible accidental feature removal");
assert.ok(before.length<=1_400_000,"Bundle exceeded 1.4 MB uncompressed regression budget");
const compressed=gzipSync(before,{level:9});
assert.ok(compressed.length<=450_000,"Bundle exceeded 450 KB gzip performance budget");
assert.ok(compressed.length<before.length*.65,"Unexpectedly incompressible bundle");

for(const id of [5,6,7,8,9]){
  for(const suffix of ["START","END"]){
    const marker="PERSONA_V4_STAGE"+id+"_"+suffix;
    assert.equal(html.split(marker).length-1,1,"Duplicate or missing Stage "+id+" marker: "+marker);
  }
  assert.ok(html.includes("PERSONA_V4_STAGE"+id+"_CSS_START"),"Missing Stage "+id+" CSS");
}
for(const key of [
  "PERSONA_HARDENING_RUNTIME_START","PERSONA_V4_SAFETY_RUNTIME_START",
  "v4s9ModalTitle","personaV4Stage9HandleModalKey",
  "personaV4Stage7ReviewExternal","personaV4Stage7AskLocal",
  "personaV4Stage8DecisionPreview",
  "personaV4Stage6SnoozeFollowUp","personaV4ParseContactCSV",
  "SecretStore.clearApiKey();","await db2.replaceStoresAtomically(data);"
])assert.ok(html.includes(key),"Security/compatibility regression: "+key);
assert.ok(html.includes('DB_VERSION = 5;'));
assert.ok(html.includes('SCHEMA_VERSION = 7;'));
assert.ok(html.includes('APP_VERSION = "3.1.1";'));
assert.equal((html.match(/<script(?:\s[^>]*)?>/g)||[]).length,1,"Expected single inline application script");
assert.ok(!/<script\b[^>]*\bsrc\s*=/i.test(html),"External script resource forbidden");
assert.ok(!/<link\b[^>]*\brel=["']stylesheet["']/i.test(html),"External stylesheet forbidden");
assert.ok(!/<iframe\b/i.test(html),"Unexpected embedded remote frame");
assert.ok(!/<meta\b[^>]*http-equiv=["']refresh["']/i.test(html),"Unexpected redirect");
assert.ok(!/navigator\.serviceWorker\.register\(\s*["']service-worker\.js/i.test(html),"Missing external worker must stay disabled");

const baseline=hash(before);
const start=performance.now();
try{
  execFileSync(process.execPath,["scripts/build.mjs"],{cwd:root,timeout:120_000,stdio:"pipe"});
  for(const file of ["scripts/fix-functional-tags.mjs","scripts/stage5-build.mjs",
    "scripts/stage6-build.mjs","scripts/stage7-build.mjs","scripts/stage8-build.mjs",
    "scripts/stage9-build.mjs","scripts/enforce-hardening-policy.mjs",
    "scripts/finalize-html-safety.mjs"]){
    execFileSync(process.execPath,[file],{cwd:root,timeout:120_000,stdio:"pipe"});
  }
}catch(error){
  throw new Error("Second deterministic build failed: "+String(error.stderr||error.message).slice(-4000));
}
const regenerated=await readFile(source);
assert.equal(hash(regenerated),baseline,
  "Two builds produced different index.html bytes; prevent nondeterministic deployment");
const elapsed=Math.round(performance.now()-start);
console.log("release-gate: PASS");
console.log(JSON.stringify({
  sourceVersion:pkg.version,stores:contract.storeNames.length,routes:contract.renderHandlers.length,
  rawBytes:before.length,gzipBytes:compressed.length,gzipRatio:+(compressed.length/before.length).toFixed(3),
  buildReproducible:true,sha256:baseline,verificationBuildMs:elapsed
},null,2));
