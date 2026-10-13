// Persona AI v4 Stage 7: deterministic source-grounded Copilot integration.
// No schema changes, cloud dependency, telemetry, or automatic external calls.
import {readFile,writeFile} from "node:fs/promises";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {personaV4EvidenceRecords,personaV4ConversationBrief,personaV4LocalEvidenceAnswer,
  personaV4ExternalEvidenceReview,personaV4ValidateExternalCitations} from "../src/domain/grounded-copilot.mjs";
import {personaV4Stage7Escape,personaV4Stage7AnswerHTML,personaV4Stage7MountCopilot,
  personaV4Stage7AskLocal,personaV4Stage7Brief,personaV4Stage7ReviewSource,
  personaV4Stage7ReviewExternal} from "../src/ui/grounded-copilot.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),".."),filename=resolve(root,"index.html");
let html=await readFile(filename,"utf8");
function replaceExactly(oldText,newText,label) {
  const idx=html.indexOf(oldText);
  if(idx<0||html.indexOf(oldText,idx+1)>=0)throw new Error("Stage 7 anchor missing or ambiguous: "+label);
  html=html.slice(0,idx)+newText+html.slice(idx+oldText.length);
}
const begin="  /* PERSONA_V4_STAGE7_START */",end="  /* PERSONA_V4_STAGE7_END */";
const fns=[personaV4EvidenceRecords,personaV4ConversationBrief,personaV4LocalEvidenceAnswer,
 personaV4ExternalEvidenceReview,personaV4ValidateExternalCitations,
 personaV4Stage7Escape,personaV4Stage7AnswerHTML,personaV4Stage7MountCopilot,
 personaV4Stage7AskLocal,personaV4Stage7Brief,personaV4Stage7ReviewSource,
 personaV4Stage7ReviewExternal];
const block=begin+"\n"+fns.map(fn=>fn.toString()).join("\n\n").split("\n").map(x=>"  "+x).join("\n")+"\n"+end;
if(html.includes(begin)){
  const a=html.indexOf(begin),b=html.indexOf(end,a);
  if(b<0)throw new Error("Incomplete Stage7 runtime block");
  html=html.slice(0,a)+block+html.slice(b+end.length);
}else replaceExactly("  // js/storage.js",block+"\n\n  // js/storage.js","embed Stage7 Copilot");

const cssStart="/* PERSONA_V4_STAGE7_CSS_START */",cssEnd="/* PERSONA_V4_STAGE7_CSS_END */";
const css=cssStart+"\n"+(await readFile(resolve(root,"src/ui/grounded-copilot.css"),"utf8")).trimEnd()+"\n"+cssEnd;
if(html.includes(cssStart)){
  const a=html.indexOf(cssStart),b=html.indexOf(cssEnd,a);
  if(b<0)throw new Error("Incomplete Stage7 stylesheet");
  html=html.slice(0,a)+css+html.slice(b+cssEnd.length);
}else{
  const pos=html.indexOf("</style>");
  if(pos<0)throw new Error("Missing style insertion point");
  html=html.slice(0,pos)+css+"\n"+html.slice(pos);
}
if(!html.includes("personaV4Stage7MountCopilot(v);"))replaceExactly(
  "    personaV4Stage6MountPlanner(v);\n    injectHelpButton(v);",
  "    personaV4Stage6MountPlanner(v);\n    personaV4Stage7MountCopilot(v);\n    injectHelpButton(v);","Copilot desk mount"
);
if(!html.includes('case "v4ConversationBrief":'))replaceExactly(
  '      case "askCopilot":',
  [
  '      case "v4ConversationBrief":',
  '        personaV4Stage7Brief();',
  '        break;',
  '      case "v4ExternalCopilotReview":',
  '        personaV4Stage7ReviewExternal();',
  '        break;',
  '      case "v4EvidenceSource":',
  '        personaV4Stage7ReviewSource(arg);',
  '        break;',
  '      case "askCopilot":'
  ].join("\n"),"Copilot evidence actions"
);

// Main Copilot workspace Ask always remains local, independent of saved API
// provider settings; an external request has a separate one-time review action.
// Preserve old function name and quick Copilot invocation for backward compat.
const askStart=html.indexOf("  async function askCopilot() {");
const askEnd=html.indexOf("  function openOpenLoopForm() {",askStart);
if(askStart<0||askEnd<0||askEnd-askStart>3000)throw new Error("Main Copilot ask handler moved");
html=html.slice(0,askStart)+
  "  async function askCopilot() {\n    personaV4Stage7AskLocal();\n  }\n"+
  html.slice(askEnd);

await writeFile(filename,html,"utf8");
