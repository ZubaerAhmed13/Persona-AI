// Persona AI v4 Stage 7 — deterministic, evidence-scoped local selectors. No network/storage side effects.
export function personaV4EvidenceRecords(data, personId, question = "", limit = 12) {
  const allowed = [
    ["interactions", ["observed","whatHappened"], ["date","createdAt"]],
    ["observations", ["content","observed"], ["date","createdAt"]],
    ["memories", ["info","text"], ["date","createdAt"]],
    ["commitments", ["commitment","description"], ["date","createdAt"]],
    ["followUps", ["text","title","description"], ["date","createdAt"]],
    ["decisions", ["question","situation"], ["date","createdAt"]],
    ["predictions", ["predictionText","prediction","target"], ["date","createdAt"]]
  ];
  if(!personId || !(data?.people || []).some(x=>x?.id===personId))return [];
  const pick=(rec,fields)=>fields.map(k=>rec[k]).find(x=>typeof x==="string"&&x.trim())||"";
  const tokens=String(question||"").toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu)||[];
  const terms=tokens.filter(x=>!["what","which","when","where","about","with","the","and","was","were","you","from","this","that","should","could","would","have","today","tomorrow","before","meeting","person","tell","last","next","please","their","there","give","show","prepare"].includes(x));
  const intent=/promis|commit|owe/i.test(question)?"commitments":/follow.?up|reach.?out/i.test(question)?"followUps":/remember|prepar|meeting|brief/i.test(question)?"memories":/decision/i.test(question)?"decisions":/predict/i.test(question)?"predictions":/interact|spoke|talk|last time/i.test(question)?"interactions":"";
  const rows=[];
  for(const [store,fields,dates] of allowed){
    for(const rec of Array.isArray(data?.[store])?data[store]:[]){
      if(!rec || typeof rec.id!=="string" || rec.personId!==personId)continue;
      const text=String(pick(rec,fields)).trim().slice(0,380);
      if(!text)continue;
      const date=String(pick(rec,dates)).slice(0,10);
      const due=String(rec.expectedCompletion||rec.dueDate||rec.reminderDate||"").slice(0,10);
      const status=String(rec.status||"").toLowerCase();
      const closed=rec.completed===true||rec.cancelled===true||["done","completed","cancelled","archived"].includes(status);
      const words=text.toLocaleLowerCase();
      const score=(store===intent?7:0)+terms.reduce((n,t)=>n+(words.includes(t)?3:0),0)+(closed&&["commitments","followUps"].includes(store)?-3:0);
      rows.push({store,id:rec.id,personId,text,date:/^\d{4}-\d{2}-\d{2}$/.test(date)?date:"",due:/^\d{4}-\d{2}-\d{2}$/.test(due)?due:"",closed,score});
    }
  }
  return rows.sort((a,b)=>b.score-a.score||b.date.localeCompare(a.date)||a.store.localeCompare(b.store)||a.id.localeCompare(b.id)).slice(0,Math.min(24,Math.max(1,Number(limit)||12)));
}

export function personaV4ConversationBrief(data, personId, today) {
  const person=(data?.people||[]).find(p=>p?.id===personId);
  if(!person)return null;
  const rows=personaV4EvidenceRecords(data,personId,"prepare for meeting",24);
  const type=(store,excludeClosed=false)=>rows.filter(x=>x.store===store&&(!excludeClosed||!x.closed));
  const interactions=type("interactions").sort((a,b)=>b.date.localeCompare(a.date));
  const memories=type("memories").sort((a,b)=>b.date.localeCompare(a.date));
  const commitments=type("commitments",true);
  const followups=type("followUps",true);
  const upcoming=[...commitments,...followups].filter(x=>x.due).sort((a,b)=>a.due.localeCompare(b.due));
  const used=[...interactions.slice(0,2),...memories.slice(0,3),...commitments.slice(0,4),...followups.slice(0,4)];
  return {personId,name:String(person.name||"Unnamed person"),today:String(today||"").slice(0,10),
    lastInteraction:interactions[0]||null,memories:memories.slice(0,3),
    openCommitments:commitments.slice(0,4),openFollowUps:followups.slice(0,4),
    nextDue:upcoming[0]||null,sourceCount:new Set(used.map(x=>x.store+"|"+x.id)).size,
    sources:used};
}

export function personaV4LocalEvidenceAnswer(question,data,personId,today) {
  const questionText=String(question||"").trim().slice(0,600);
  const brief=personaV4ConversationBrief(data,personId,today);
  if(!brief)return {answer:"Select a person to examine their saved records. I won’t guess which person you mean.",citations:[],confidence:"Low",kind:"local-evidence",why:["No person was selected."],epistemic:"UNKNOWN"};
  const q=questionText.toLowerCase();
  let citations=personaV4EvidenceRecords(data,personId,q,8),prefix="";
  if(/promis|commit|owe/.test(q)){citations=citations.filter(x=>x.store==="commitments"&&!x.closed);prefix="Open recorded commitments";}
  else if(/follow.?up|reach.?out/.test(q)){citations=citations.filter(x=>x.store==="followUps"&&!x.closed);prefix="Pending recorded follow-ups";}
  else if(/what.*remember|memories|remember about/.test(q)){citations=citations.filter(x=>x.store==="memories");prefix="Saved memories";}
  else if(/last (interaction|conversation)|last time|spoke|talked/.test(q)){citations=brief.lastInteraction?[brief.lastInteraction]:[];prefix="Last recorded interaction";}
  else if(/meeting|prepar|brief/.test(q)){citations=brief.sources.slice(0,8);prefix="Conversation preparation";}
  else{prefix="Relevant saved records";}
  const noRecords=!citations.length;
  const excerpt=noRecords?"I found no matching records for this person. This does not mean an event never happened.":
    citations.slice(0,5).map((r,i)=>(i+1)+". "+r.text+(r.due?" (recorded due "+r.due+")":"")).join("\n");
  const caution="These are records you saved, not verified facts about someone's intentions. Do not infer motives, diagnoses, or relationship quality from them alone.";
  const why=noRecords?["Insufficient recorded evidence."]:["Each item below links to its original saved record.","Interpretations and unverified inferences are excluded from the supporting snippets."];
  return {answer:prefix+" for "+brief.name+":\n"+excerpt+"\n\n"+caution,
    citations:citations.slice(0,8).map(({store,id,personId,text,date})=>({store,id,personId,text,date,sourceId:store+":"+id})),
    why,confidence:noRecords?"Low":"Moderate",kind:"local-evidence",epistemic:noRecords?"UNKNOWN":"OBSERVED",sourceCount:citations.length};
}

export function personaV4ExternalEvidenceReview(question,data,personId) {
  const q=String(question||"").trim().slice(0,600);
  const person=(data?.people||[]).find(p=>p?.id===personId);
  if(!q||!person)return null;
  const source=personaV4EvidenceRecords(data,personId,q,6);
  return {question:q,person:{id:person.id,name:person.name},
    evidence:source.map(({store,id,text,date,due})=>({store,id,text,date,due})),version:"persona-v4-stage7-minimal-context"};
}

export function personaV4ValidateExternalCitations(output,packet) {
  if(!output||typeof output!=="object"||typeof output.answer!=="string"||output.answer.length>4000)return {ok:false,reason:"Missing or invalid answer."};
  if(!Array.isArray(output.evidenceIds)||!output.evidenceIds.length)return {ok:false,reason:"No supporting source IDs returned."};
  const ids=new Set((packet?.evidence||[]).map(x=>x.id));
  if(output.evidenceIds.length>6||output.evidenceIds.some(id=>!ids.has(id)))return {ok:false,reason:"The response cited records outside the approved context."};
  if(/(?:narcissis|psychopath|sociopath|personality disorder|diagnos|manipulat|liar|secretly wants|hidden motive|definitely knows|100% certain|guaranteed)/i.test(output.answer))return {ok:false,reason:"The response contained an unsupported personal inference."};
  return {ok:true,citations:packet.evidence.filter(x=>output.evidenceIds.includes(x.id))};
}
