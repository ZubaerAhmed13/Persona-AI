import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const sourcePath = resolve("scripts/full-browser-acceptance.mjs");
const diagnosticPath = resolve("scripts/.full-browser-acceptance-diagnostic.mjs");
let source = await readFile(sourcePath, "utf8");
const oldAssertion = '    assert.equal(runtimeErrors.length, errorsBefore, `${view}: uncaught runtime error`);';
const newAssertion = '    assert.equal(runtimeErrors.length, errorsBefore, `${view}: uncaught runtime error: ${runtimeErrors.slice(errorsBefore).join(" | ")}`);';
if (!source.includes(oldAssertion)) throw new Error("Diagnostic assertion anchor not found");
source = source.replace(oldAssertion, newAssertion);
await writeFile(diagnosticPath, source, "utf8");
await import(`./.full-browser-acceptance-diagnostic.mjs?${Date.now()}`);
