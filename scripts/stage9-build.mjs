// Stage 9: deterministic mobile and keyboard accessibility hardening.
// Embeds local UI helpers into the same offline index.html (no new dependency).
import {readFile,writeFile} from "node:fs/promises";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {
  personaV4Stage9Focusable,personaV4Stage9HandleModalKey,
  personaV4Stage9SyncMobileNav,personaV4Stage9EnhanceView,
  personaV4Stage9FocusRoute
} from "../src/ui/mobile-accessibility.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const path=resolve(root,"index.html");
let html=await readFile(path,"utf8");
function replaceOne(from,to,label){
  const first=html.indexOf(from);
  if(first<0||html.indexOf(from,first+1)>=0)throw new Error("Stage 9 build anchor missing/ambiguous: "+label);
  html=html.slice(0,first)+to+html.slice(first+from.length);
}
const start="  /* PERSONA_V4_STAGE9_START */",end="  /* PERSONA_V4_STAGE9_END */";
const funcs=[
  personaV4Stage9Focusable,personaV4Stage9HandleModalKey,
  personaV4Stage9SyncMobileNav,personaV4Stage9EnhanceView,
  personaV4Stage9FocusRoute
];
const runtime=start+"\n"+funcs.map(f=>f.toString()).join("\n\n").split("\n").map(x=>"  "+x).join("\n")+"\n"+end;
if(html.includes(start)){
  const a=html.indexOf(start),b=html.indexOf(end,a);
  if(b<0)throw new Error("Incomplete Stage 9 runtime");
  html=html.slice(0,a)+runtime+html.slice(b+end.length);
}else replaceOne("  // js/storage.js",runtime+"\n\n  // js/storage.js","runtime inject");
const cssStart="/* PERSONA_V4_STAGE9_CSS_START */",cssEnd="/* PERSONA_V4_STAGE9_CSS_END */";
const css=cssStart+"\n"+(await readFile(resolve(root,"src/ui/mobile-accessibility.css"),"utf8")).trimEnd()+"\n"+cssEnd;
if(html.includes(cssStart)){
  const a=html.indexOf(cssStart),b=html.indexOf(cssEnd,a);
  if(b<0)throw new Error("Incomplete Stage 9 CSS");
  html=html.slice(0,a)+css+html.slice(b+cssEnd.length);
}else{
  const i=html.indexOf("</style>");
  if(i<0)throw new Error("Head stylesheet missing");
  html=html.slice(0,i)+css+"\n"+html.slice(i);
}

if(!html.includes("personaV4Stage9EnhanceView(v);"))replaceOne(
  "    personaV4Stage8Mount(v);\n    injectHelpButton(v);",
  "    personaV4Stage8Mount(v);\n    personaV4Stage9EnhanceView(v);\n    injectHelpButton(v);",
  "add semantic headings and accessible mobile navigation"
);

// Focus should return to the caller when a modal closes. Trap both Tab
// directions and clean up keydown listeners to avoid accumulating handlers.
if(!html.includes("let personaV4Stage9PreviousFocus = null;")){
  replaceOne("  function openModal({ title, subtitle, body, footer, size = \"\", help }) {",
    "  let personaV4Stage9PreviousFocus = null;\n  let personaV4Stage9ModalHandler = null;\n  function openModal({ title, subtitle, body, footer, size = \"\", help }) {",
    "modal focus state");
  replaceOne(
    '    closeModal();\n    const root2 = document.getElementById("modalRoot");',
    '    closeModal();\n    personaV4Stage9PreviousFocus = document.activeElement;\n    const root2 = document.getElementById("modalRoot");',
    "remember modal caller");
  replaceOne(
    '    const bodyEl = backdrop.querySelector("[data-body]");',
    '    backdrop.setAttribute("aria-labelledby","v4s9ModalTitle");\n    backdrop.querySelector(".modal-title").id="v4s9ModalTitle";\n    const bodyEl = backdrop.querySelector("[data-body]");',
    "modal name");
  replaceOne(
    '    const onKey = (e) => {\n      if (e.key === "Escape") closeModal();\n    };\n    document.addEventListener("keydown", onKey);\n    backdrop.dataset.keyHandler = "1";',
    '    const onKey = (e) => personaV4Stage9HandleModalKey(e, backdrop, closeModal);\n    personaV4Stage9ModalHandler = onKey;\n    document.addEventListener("keydown", onKey);\n    backdrop.dataset.keyHandler = "1";',
    "replace modal keyboard handling");
  replaceOne(
    '  function closeModal() {\n    const root2 = document.getElementById("modalRoot");\n    root2.innerHTML = "";\n  }',
    [
      '  function closeModal() {',
      '    const root2 = document.getElementById("modalRoot");',
      '    const wasOpen = Boolean(root2?.querySelector(".modal-backdrop"));',
      '    if (personaV4Stage9ModalHandler) {',
      '      document.removeEventListener("keydown", personaV4Stage9ModalHandler);',
      '      personaV4Stage9ModalHandler = null;',
      '    }',
      '    root2.innerHTML = "";',
      '    const restore = personaV4Stage9PreviousFocus;',
      '    personaV4Stage9PreviousFocus = null;',
      '    if(wasOpen && restore?.isConnected && typeof restore.focus === "function") restore.focus({preventScroll:true});',
      '  }'
    ].join("\n"),"clean up modal and restore focus");
}

// Focus screen heading only for explicit keyboard/navigation selections.
// CRUD rerenders and field edits retain their existing focus semantics.
if(!html.includes("const v4s9FromNavigation = Boolean(")){
  replaceOne(
    '  function navigate2(view, arg) {\n    if (arg) getState().focusPersonId = arg;',
    '  function navigate2(view, arg) {\n    const v4s9FromNavigation = Boolean(document.activeElement?.closest("[data-view],[data-v4-view],[data-v4-mobile],[data-goto]"));\n    if (arg) getState().focusPersonId = arg;',
    "navigation context");
  replaceOne(
    '    personaV4SyncWorkspace(view);\n    render();\n  }\n  function renderCurrent()',
    '    personaV4SyncWorkspace(view);\n    render();\n    if (v4s9FromNavigation) personaV4Stage9FocusRoute();\n  }\n  function renderCurrent()',
    "navigation focus management");
}

await writeFile(path,html,"utf8");
