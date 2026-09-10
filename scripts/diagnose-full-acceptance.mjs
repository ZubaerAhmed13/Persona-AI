import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const sourcePath = resolve("scripts/full-browser-acceptance.mjs");
const diagnosticPath = resolve("scripts/.full-browser-acceptance-diagnostic.mjs");
let source = await readFile(sourcePath, "utf8");

const oldAssertion = '    assert.equal(runtimeErrors.length, errorsBefore, `${view}: uncaught runtime error`);';
const newAssertion = '    assert.equal(runtimeErrors.length, errorsBefore, `${view}: uncaught runtime error: ${runtimeErrors.slice(errorsBefore).join(" | ")}`);';
if (!source.includes(oldAssertion)) throw new Error("Diagnostic route assertion anchor not found");
source = source.replace(oldAssertion, newAssertion);

const oldCreatedWait = '  await waitUntil(cdp, `Array.from(document.querySelectorAll(\'.person-name,.strong\')).some(x => (x.textContent||\'\').includes(${JSON.stringify(WORKFLOW_PERSON)}))`, "created person rendered");';
const newCreatedWait = `  await sleep(700);\n  const crudDiagDb = await snapshot(cdp);\n  const crudDiagUi = await cdp.evaluate(\`({view:document.querySelector('#view')?.innerText||'', modal:document.querySelector('#modalRoot')?.innerText||'', toasts:document.querySelector('#toastRoot')?.innerText||'', title:document.querySelector('.page-title')?.innerText||''})\`);\n  console.log("CRUD_DIAGNOSTIC", JSON.stringify({ people: crudDiagDb.people?.map(p => ({id:p.id,name:p.name})) || [], ui: crudDiagUi, runtimeErrors }));\n  await waitUntil(cdp, \`(document.querySelector('#view')?.innerText||'').includes(\${JSON.stringify(WORKFLOW_PERSON)})\`, "created person visible in rendered view");`;
if (!source.includes(oldCreatedWait)) throw new Error("Diagnostic CRUD wait anchor not found");
source = source.replace(oldCreatedWait, newCreatedWait);

await writeFile(diagnosticPath, source, "utf8");
await import(`./.full-browser-acceptance-diagnostic.mjs?${Date.now()}`);
