// Everyday-use UX improvements. All original stores, routes and historical
// views remain available. Changes are deterministic for the offline HTML.
import {readFile,writeFile} from "node:fs/promises";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {personaV4uxDirectory} from "../src/domain/daily-use.mjs";
import {
 personaV4uxCard,personaV4uxDirectoryHTML,personaV4uxRefreshDirectory,
 personaV4uxBindDirectory,personaV4uxDirectoryMore,personaV4uxDirectoryClear,
 personaV4uxEnhance,personaV4uxInitSearchKeyboard
} from "../src/ui/daily-use.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),".."),file=resolve(root,"index.html");
let html=await readFile(file,"utf8");
function replaceOnce(oldValue,newValue,label){
 const a=html.indexOf(oldValue);
 if(a<0||html.indexOf(oldValue,a+1)!==-1)throw new Error("Daily UX build anchor missing or repeated: "+label);
 html=html.slice(0,a)+newValue+html.slice(a+oldValue.length);
}
const first="  /* PERSONA_V4_DAILY_UX_START */",last="  /* PERSONA_V4_DAILY_UX_END */";
const funcs=[
 personaV4uxDirectory,personaV4uxCard,personaV4uxDirectoryHTML,
 personaV4uxRefreshDirectory,personaV4uxBindDirectory,personaV4uxDirectoryMore,
 personaV4uxDirectoryClear,personaV4uxEnhance,personaV4uxInitSearchKeyboard
];
const runtime=first+"\n"+funcs.map(f=>f.toString()).join("\n\n").split("\n").map(x=>"  "+x).join("\n")+"\n"+last;
if(html.includes(first)){
 const a=html.indexOf(first),b=html.indexOf(last,a);
 if(b<0)throw Error("Incomplete daily UX bundle");
 html=html.slice(0,a)+runtime+html.slice(b+last.length);
}else replaceOnce("  // js/storage.js",runtime+"\n\n  // js/storage.js","runtime");

const cssFirst="/* PERSONA_V4_DAILY_UX_CSS_START */",cssLast="/* PERSONA_V4_DAILY_UX_CSS_END */";
const css=cssFirst+"\n"+(await readFile(resolve(root,"src/ui/daily-use.css"),"utf8")).trimEnd()+"\n"+cssLast;
if(html.includes(cssFirst)){
 const a=html.indexOf(cssFirst),b=html.indexOf(cssLast,a);
 if(b<0)throw Error("Incomplete daily UX styles");
 html=html.slice(0,a)+css+html.slice(b+cssLast.length);
}else{
 const a=html.indexOf("</style>");
 if(a<0)throw Error("Style block not found");
 html=html.slice(0,a)+css+"\n"+html.slice(a);
}

// Keep the historic renderPeople() entrypoint while switching the directory
// itself to bounded cards. Person profiles still use the untouched renderer.
const peopleStart="  function renderPeople() {";
const peopleEnd="  function personCard(p) {";
const a=html.indexOf(peopleStart),b=html.indexOf(peopleEnd,a);
if(a<0||b<0||b-a>4500)throw Error("People screen layout changed unexpectedly");
const newPeople="  function renderPeople() {\n"+
  "    const id=getState().focusPersonId;\n"+
  "    if(id)return renderPersonProfile(byId(\"people\",id));\n"+
  "    return personaV4uxDirectoryHTML();\n"+
  "  }\n";
html=html.slice(0,a)+newPeople+html.slice(b);

if(!html.includes("personaV4uxEnhance(v);"))replaceOnce(
 "    personaV4Stage9EnhanceView(v);\n    injectHelpButton(v);",
 "    personaV4Stage9EnhanceView(v);\n    personaV4uxEnhance(v);\n    personaV4uxInitSearchKeyboard();\n    injectHelpButton(v);",
 "view enhancements");
if(!html.includes("    personaV4uxBindDirectory();"))replaceOnce(
 "    personaV4BindPeopleActivity();\n  }\n  function bindReportSections()",
 "    personaV4BindPeopleActivity();\n    personaV4uxBindDirectory();\n  }\n  function bindReportSections()",
 "bind live directory search");

// The same one-file delegated action dispatcher remains authoritative.
if(!html.includes('case "v4uxPeopleMore":'))replaceOnce(
 '      case "addPerson":',
 [
 '      case "v4uxPeopleMore":',
 '        personaV4uxDirectoryMore();',
 '        break;',
 '      case "v4uxClearPeople":',
 '        personaV4uxDirectoryClear();',
 '        break;',
 '      case "addPerson":'
 ].join("\n"),"directory actions");
await writeFile(file,html,"utf8");
