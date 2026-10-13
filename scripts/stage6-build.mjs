// Stage 6: deterministic, local-first planning integration.
// Runs after all earlier build stages and before final hardening/safety checks.
// Intentionally changes no database version, settings, network, or backup policy.
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  personaV4TaskDay, personaV4TaskBuckets, personaV4WeeklyPlan, personaV4ValidateTaskDate
} from "../src/domain/followup-planner.mjs";
import {
  personaV4Stage6TaskRow, personaV4Stage6RenderFollowUps, personaV4Stage6MountPlanner,
  personaV4Stage6SnoozeFollowUp, personaV4Stage6ReopenFollowUp, personaV4Stage6RescheduleTask
} from "../src/ui/followup-planner.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const filename = resolve(root, "index.html");
let html = await readFile(filename,"utf8");
function replaceOne(from,to,desc) {
  const first=html.indexOf(from);
  if(first<0||html.indexOf(from,first+1)>=0)throw new Error(desc+": expected one matching build anchor");
  html=html.slice(0,first)+to+html.slice(first+from.length);
}
function inject(start,end,source,anchor) {
  const begin=html.indexOf(start);
  if(begin>=0) {
    const finish=html.indexOf(end,begin+start.length);
    if(finish<0)throw new Error("Incomplete Stage 6 injection: "+start);
    html=html.slice(0,begin)+source+html.slice(finish+end.length);
  } else replaceOne(anchor,source+"\n\n"+anchor,"Stage 6 runtime injection");
}

const runtimeStart="  /* PERSONA_V4_STAGE6_START */";
const runtimeEnd="  /* PERSONA_V4_STAGE6_END */";
const funcs=[
  personaV4TaskDay,personaV4TaskBuckets,personaV4WeeklyPlan,personaV4ValidateTaskDate,
  personaV4Stage6TaskRow,personaV4Stage6RenderFollowUps,personaV4Stage6MountPlanner,
  personaV4Stage6SnoozeFollowUp,personaV4Stage6ReopenFollowUp,personaV4Stage6RescheduleTask
];
const runtime=runtimeStart+"\n"+funcs.map(fn=>fn.toString()).join("\n\n").split("\n").map(x=>"  "+x).join("\n")+"\n"+runtimeEnd;
inject(runtimeStart,runtimeEnd,runtime,"  // js/storage.js");

const cssStart="/* PERSONA_V4_STAGE6_CSS_START */";
const cssEnd="/* PERSONA_V4_STAGE6_CSS_END */";
const css=cssStart+"\n"+(await readFile(resolve(root,"src/ui/followup-planner.css"),"utf8")).trimEnd()+"\n"+cssEnd;
const firstStyleClose=html.indexOf("</style>");
if(firstStyleClose<0)throw new Error("Missing CSS end tag");
const existingStyle=html.indexOf(cssStart);
if(existingStyle>=0) {
  const last=html.indexOf(cssEnd,existingStyle);
  if(last<0)throw new Error("Missing Stage6 CSS end marker");
  html=html.slice(0,existingStyle)+css+html.slice(last+cssEnd.length);
} else html=html.slice(0,firstStyleClose)+css+"\n"+html.slice(firstStyleClose);

// Preserve Stage 2's historical followups route name and its source module.
// The bundled implementation forwards to the new read-only stage6 selector.
const followupStart='  function renderPersonaV4FollowUps() {';
const followupEnd='  /* PERSONA_V4_WORKSPACE_RUNTIME_END */';
const a=html.indexOf(followupStart), b=html.indexOf(followupEnd,a);
if(a<0||b<0||b-a>6500)throw new Error("Stage 2 Follow-ups renderer bounds changed");
const wrapper='  function renderPersonaV4FollowUps() {\n    return personaV4Stage6RenderFollowUps();\n  }\n';
html=html.slice(0,a)+wrapper+html.slice(b);

// Add read-only plan panels on legacy Commitments and Review pages.
if(!html.includes("personaV4Stage6MountPlanner(v);"))replaceOne(
  '    personaV4MountImportControls(v);\n    injectHelpButton(v);',
  '    personaV4MountImportControls(v);\n    personaV4Stage6MountPlanner(v);\n    injectHelpButton(v);',
  "Stage6 planner mount"
);

// Reuse delegated action dispatch and the existing, tested state/update routines.
if(!html.includes('case "v4FollowUpTab":'))replaceOne(
  '      case "addFollowUp":\n        openFollowUpForm(arg);',
  [
    '      case "v4FollowUpTab":',
    '        getState()._v4Stage6Tab = arg;',
    '        render();',
    '        break;',
    '      case "v4SnoozeTask":',
    '        void personaV4Stage6SnoozeFollowUp(arg, el?.getAttribute("data-days"));',
    '        break;',
    '      case "v4RescheduleTask":',
    '        personaV4Stage6RescheduleTask(arg);',
    '        break;',
    '      case "v4ReopenFollowUp":',
    '        void personaV4Stage6ReopenFollowUp(arg);',
    '        break;',
    '      case "addFollowUp":',
    '        openFollowUpForm(arg);'
  ].join("\n"),"Stage6 action dispatch"
);

// Legacy commitments used expectedCompletion exclusively; older backups use
// dueDate. Honor both without modifying any historical record.
const commitStart='  function renderCommitmentCenter() {';
const commitRow='  function commitmentCenterRow(c) {';
const ci=html.indexOf(commitStart),ri=html.indexOf(commitRow,ci);
if(ci<0||ri<0||ri-ci>7500)throw new Error("Legacy commitment renderer moved");
let summary=html.slice(ci,ri);
summary=summary.replace('const today = now.toISOString().slice(0, 10);','const today = todayLocal();');
summary=summary.replaceAll('c.expectedCompletion && c.expectedCompletion.slice(0, 10)',
  '(c.expectedCompletion || c.dueDate) && (c.expectedCompletion || c.dueDate).slice(0, 10)');
summary=summary.replace('&& !c.expectedCompletion)', '&& !(c.expectedCompletion || c.dueDate))');
if(!summary.includes('(c.expectedCompletion || c.dueDate).slice(0, 10)'))throw new Error("Legacy commitment due-date compatibility not applied");
html=html.slice(0,ci)+summary+html.slice(ri);

const ri2=html.indexOf(commitRow);
const rend=html.indexOf('  function renderPlaybook() {',ri2);
if(ri2<0||rend<0||rend-ri2>5200)throw new Error("Commitment row boundaries changed");
let row=html.slice(ri2,rend);
row=row.replace('c.expectedCompletion && new Date(c.expectedCompletion) < /* @__PURE__ */ new Date()',
  'personaCalendarDay(c.expectedCompletion || c.dueDate) && personaCalendarDay(c.expectedCompletion || c.dueDate) < todayLocal()');
row=row.replace('esc2(c.commitment)','esc2(c.commitment || c.description || "Commitment")');
row=row.replace('c.expectedCompletion ? " \\xB7 Due: " + fmtDate(c.expectedCompletion)', 
  '(c.expectedCompletion || c.dueDate) ? " \\xB7 Due: " + fmtDate(c.expectedCompletion || c.dueDate)');
if(!row.includes('esc2(c.commitment || c.description || "Commitment")'))throw new Error("Legacy commitment description compatibility not applied");
html=html.slice(0,ri2)+row+html.slice(rend);

await writeFile(filename,html,"utf8");
