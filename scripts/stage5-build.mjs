// Stage 5 deterministic final build transform. Source modules are the authority;
// production remains a self-contained HTML file with no extra network assets.
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  personaV4NormalizeContact, personaV4PersonMatches, personaV4MentionedPeople,
  personaV4InteractionDuplicates, personaV4ParseContactCSV, personaV4ContactCSVPreview,
  personaV4SearchRecords
} from "../src/domain/smart-capture.mjs";
import {
  personaV4ImportContactsAtomic, personaV4OpenContactsCSV,
  personaV4MountImportControls, personaV4OpenUniversalCapture
} from "../src/ui/smart-capture.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const indexFile = resolve(root, "index.html");
let html = await readFile(indexFile, "utf8");
function replaceOne(from, to, label) {
  const first = html.indexOf(from);
  if (first < 0 || html.indexOf(from, first + 1) >= 0) throw new Error(label + ": source anchor missing/ambiguous");
  html = html.slice(0,first) + to + html.slice(first+from.length);
}
function insertOrReplace(startMarker, endMarker, text, anchor) {
  const start = html.indexOf(startMarker);
  if (start >= 0) {
    const end = html.indexOf(endMarker, start);
    if (end < 0) throw new Error("Incomplete Stage 5 injected block");
    html = html.slice(0,start) + text + html.slice(end+endMarker.length);
  } else replaceOne(anchor, text + "\n\n" + anchor, "stage5 injection " + startMarker);
}
const domainAndUI = [
  personaV4NormalizeContact, personaV4PersonMatches, personaV4MentionedPeople,
  personaV4InteractionDuplicates, personaV4ParseContactCSV, personaV4ContactCSVPreview,
  personaV4SearchRecords, personaV4ImportContactsAtomic,
  personaV4OpenContactsCSV, personaV4MountImportControls, personaV4OpenUniversalCapture
];
const runtimeStart = "  /* PERSONA_V4_SMART_CAPTURE_START */";
const runtimeEnd = "  /* PERSONA_V4_SMART_CAPTURE_END */";
const runtime = runtimeStart + "\n" + domainAndUI.map(fn=>fn.toString())
  .join("\n\n").split("\n").map(line=>"  "+line).join("\n") + "\n" + runtimeEnd;
insertOrReplace(runtimeStart,runtimeEnd,runtime,"  // js/storage.js");

const cssStart = "/* PERSONA_V4_SMART_CAPTURE_CSS_START */";
const cssEnd = "/* PERSONA_V4_SMART_CAPTURE_CSS_END */";
const css = await readFile(resolve(root,"src/ui/smart-capture.css"),"utf8");
const cssText = cssStart+"\n"+css.trimEnd()+"\n"+cssEnd;
if (html.includes(cssStart)) insertOrReplace(cssStart,cssEnd,cssText,"</style>");
else { const close=html.indexOf("</style>"); if (close<0) throw new Error("Stage 5 style closing tag missing"); html=html.slice(0,close)+cssText+"\n"+html.slice(close); }

// Mount the contact-import launcher only on the People list and Data screen.
if (!html.includes("personaV4MountImportControls(v);")) replaceOne(
  "    personaV4MountPeopleActivity(v);\n    injectHelpButton(v);",
  "    personaV4MountPeopleActivity(v);\n    personaV4MountImportControls(v);\n    injectHelpButton(v);",
  "Stage 5 import entry"
);
if (!html.includes('case "importContactsCSV":')) replaceOne(
  '      case "universalCapture":\n        openUniversalCapture();',
  '      case "importContactsCSV":\n        personaV4OpenContactsCSV();\n        break;\n      case "universalCapture":\n        personaV4OpenUniversalCapture();',
  "Stage 5 action routing"
);

// Preserve the old search routine as a compatibility fallback, but replace the
// active search with a ranked lexical selector. Ordinary terms must NOT match
// arbitrary records merely because no structured filters were supplied.
if (!html.includes("  function legacySearchAll(q) {")) replaceOne(
  '  function searchAll(q) {\n    const s = getState();',
  [
    '  function searchAll(q) {',
    '    const nl = parseNaturalSearch(q);',
    '    const scoped = Boolean(nl.days || (nl.personId && /\\b(?:about|with|for|from)\\b/i.test(q)));',
    '    const d = new Date();',
    '    if (nl.days) d.setDate(d.getDate() - nl.days);',
    '    const cutoff = [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");',
    '    return personaV4SearchRecords(scoped ? "" : q, getState().data, scoped ? {personId:nl.personId,days:nl.days,cutoff} : {});',
    '  }',
    '  function legacySearchAll(q) {',
    '    const s = getState();'
  ].join("\n"),
  "relevance-first search"
);

// A duplicate warning must never be followed by an unconditional person write.
const dupStart = '        const existing = peopleList().find((x) => x.name.trim().toLowerCase() === name.toLowerCase());';
const dupEnd = '        toast("Person added.", "ok");';
if (html.includes(dupStart)) {
  const a = html.indexOf(dupStart), b = html.indexOf(dupEnd,a);
  if (b < 0 || b-a > 600) throw new Error("Unexpected old person save handler");
  html = html.slice(0,a) + [
    '        const similar = personaV4PersonMatches(name, peopleList());',
    '        if (similar.length) {',
    '          confirmDialog({',
    '            title: "Possible duplicate person",',
    '            message: "A profile named " + similar[0].name + " already exists. Creating another may split their history. Continue only if this is really a separate person.",',
    '            confirmText: "Create separate profile",',
    '            onConfirm: async () => {',
    '              await create2("people", data);',
    '              toast("Separate person profile added.", "ok");',
    '              syncContextSelect();',
    '              navigate2("people");',
    '            }',
    '          });',
    '          return;',
    '        }',
    '        await create2("people", data);',
    '        toast("Person added.", "ok");'
  ].join("\n") + html.slice(b+dupEnd.length);
} else if (!html.includes('title: "Possible duplicate person"')) throw new Error("Unknown person duplicate state");

// Quick Capture also requires an explicit second confirmation for identical
// person + calendar date + normalized note; modifying the note resets approval.
const quickStart = html.indexOf("  function openQuickCapture(preselectId) {");
const quickEnd = html.indexOf("  function openMemoryForm(preselectId)", quickStart);
if (quickStart<0 || quickEnd<0) throw new Error("Quick Capture function boundaries missing");
let quick = html.slice(quickStart,quickEnd);
const quickOld = '      const { create: create2 } = await Promise.resolve().then(() => (init_state(), state_exports));\n      await create2("interactions", {';
if (!quick.includes("m.bodyEl.dataset.v4DuplicateConfirmed")) {
  if(!quick.includes(quickOld))throw new Error("Quick Capture save anchor missing");
  quick = quick.replace(quickOld, [
    '      const day = m.bodyEl.querySelector("#qc_date")?.value || new Date().toISOString().slice(0,10);',
    '      const signature = personId+"|"+day+"|"+personaV4NormalizeContact(what);',
    '      if (personaV4InteractionDuplicates(personId,what,day,getState().data.interactions).length && m.bodyEl.dataset.v4DuplicateConfirmed !== signature) {',
    '        m.bodyEl.dataset.v4DuplicateConfirmed = signature;',
    '        save.textContent = "Save anyway (possible duplicate)";',
    '        toast("A record with the same person, date and note exists. Review it before selecting Save anyway.", "warn", "Possible duplicate");',
    '        return;',
    '      }',
    '      save.disabled = true;',
    quickOld
  ].join("\n"));
  html = html.slice(0,quickStart)+quick+html.slice(quickEnd);
}

await writeFile(indexFile,html,"utf8");
