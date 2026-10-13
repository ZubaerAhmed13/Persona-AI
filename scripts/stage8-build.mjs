// Persona AI 4.0 Stage 8 — deterministic offline relationship/decision explorer.
// Pure domain/UI selectors are embedded inside the existing single-file artifact.
import {readFile,writeFile} from "node:fs/promises";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {personaV4Stage8Records,personaV4Stage8Network,personaV4Stage8EvidenceCoverage,personaV4Stage8DecisionPreview} from "../src/domain/relationship-network.mjs";
import {personaV4Stage8Escape,personaV4Stage8Graph,personaV4Stage8EvidenceRow,personaV4Stage8NetworkHTML,
  personaV4Stage8Mount,personaV4Stage8UpdateNetwork,personaV4Stage8SelectPerson,
  personaV4Stage8OpenRecord,personaV4Stage8DecisionEvidence} from "../src/ui/relationship-network.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const filename=resolve(root,"index.html");
let html=await readFile(filename,"utf8");
function replaceExactly(before,after,desc) {
  const a=html.indexOf(before);
  if(a<0||html.indexOf(before,a+1)>=0)throw new Error("Stage8 missing or ambiguous anchor: "+desc);
  html=html.slice(0,a)+after+html.slice(a+before.length);
}
const start="  /* PERSONA_V4_STAGE8_START */",end="  /* PERSONA_V4_STAGE8_END */";
const all=[
 personaV4Stage8Records,personaV4Stage8Network,personaV4Stage8EvidenceCoverage,personaV4Stage8DecisionPreview,
 personaV4Stage8Escape,personaV4Stage8Graph,personaV4Stage8EvidenceRow,personaV4Stage8NetworkHTML,
 personaV4Stage8Mount,personaV4Stage8UpdateNetwork,personaV4Stage8SelectPerson,
 personaV4Stage8OpenRecord,personaV4Stage8DecisionEvidence
];
const block=start+"\n"+all.map(x=>x.toString()).join("\n\n").split("\n").map(x=>"  "+x).join("\n")+"\n"+end;
if(html.includes(start)){
  const a=html.indexOf(start),b=html.indexOf(end,a);
  if(b<0)throw new Error("Incomplete Stage8 runtime");
  html=html.slice(0,a)+block+html.slice(b+end.length);
}else replaceExactly("  // js/storage.js",block+"\n\n  // js/storage.js","inject network runtime");

const cssStart="/* PERSONA_V4_STAGE8_CSS_START */",cssEnd="/* PERSONA_V4_STAGE8_CSS_END */";
const css=cssStart+"\n"+(await readFile(resolve(root,"src/ui/relationship-network.css"),"utf8")).trimEnd()+"\n"+cssEnd;
if(html.includes(cssStart)){
 const a=html.indexOf(cssStart),b=html.indexOf(cssEnd,a);
 if(b<0)throw new Error("Incomplete Stage8 CSS");
 html=html.slice(0,a)+css+html.slice(b+cssEnd.length);
}else{
 const a=html.indexOf("</style>");
 if(a<0)throw new Error("Stylesheet close missing");
 html=html.slice(0,a)+css+"\n"+html.slice(a);
}

if(!html.includes("personaV4Stage8Mount(v);"))replaceExactly(
 "    personaV4Stage7MountCopilot(v);\n    injectHelpButton(v);",
 "    personaV4Stage7MountCopilot(v);\n    personaV4Stage8Mount(v);\n    injectHelpButton(v);",
 "mount Stage8 network and decision source previews"
);
if(!html.includes('case "v4NetworkSelect":'))replaceExactly(
 '      case "v4ConversationBrief":',
 [
 '      case "v4NetworkSelect":',
 '        personaV4Stage8SelectPerson(arg);',
 '        break;',
 '      case "v4NetworkSource":',
 '        personaV4Stage8OpenRecord(arg);',
 '        break;',
 '      case "v4DecisionEvidence":',
 '        personaV4Stage8DecisionEvidence();',
 '        break;',
 '      case "v4ConversationBrief":'
 ].join("\n"),
 "wire Stage8 delegated UI actions"
);
await writeFile(filename,html,"utf8");
