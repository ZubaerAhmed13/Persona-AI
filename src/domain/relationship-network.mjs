// Persona AI v4 Stage 8: evidence-grounded hub network and decision context. Pure, offline selectors.

export function personaV4Stage8Records(data,personId,limit=12) {
  const columns={
    interactions:["observed","whatHappened","type"],observations:["observedBehavior","content","observed"],
    memories:["info","text"],commitments:["commitment","description"],followUps:["text","description","title"],
    decisions:["question","situation"]
  };
  if(!personId||!Array.isArray(data?.people)||!data.people.some(x=>x?.id===personId))return [];
  const results=[];
  for(const [store,keys] of Object.entries(columns)){
    for(const r of Array.isArray(data?.[store])?data[store]:[]){
      if(!r||r.personId!==personId||typeof r.id!=="string")continue;
      const source=keys.map(k=>r[k]).find(x=>typeof x==="string"&&x.trim());
      const excerpt=String(source||"Recorded "+store).trim().slice(0,300);
      const dateRaw=String(r.date||r.createdAt||"").slice(0,10);
      const date=/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)?dateRaw:"";
      results.push({id:r.id,store,personId,date,text:excerpt});
    }
  }
  return results.sort((a,b)=>b.date.localeCompare(a.date)||a.store.localeCompare(b.store)||a.id.localeCompare(b.id)).slice(0,Math.max(1,Math.min(40,limit)));
}

export function personaV4Stage8Network(data,filter="") {
  const term=String(filter||"").trim().toLocaleLowerCase();
  const people=(Array.isArray(data?.people)?data.people:[]).filter(p=>p&&typeof p.id==="string");
  const interactions=Array.isArray(data?.interactions)?data.interactions:[];
  const count=new Map(),recent=new Map();
  for(const i of interactions){
    if(!i||typeof i.personId!=="string"||!people.some(p=>p.id===i.personId))continue;
    count.set(i.personId,(count.get(i.personId)||0)+1);
    const day=String(i.date||i.createdAt||"").slice(0,10);
    if(/^\d{4}-\d{2}-\d{2}$/.test(day)&&day>(recent.get(i.personId)||""))recent.set(i.personId,day);
  }
  const all=people.filter(p=>(String(p.name||"")+" "+String(p.relationshipType||"")+" "+String(p.organization||"")).toLocaleLowerCase().includes(term))
    .sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""))||a.id.localeCompare(b.id));
  const nodes=all.slice(0,24).map(p=>({id:p.id,name:String(p.name||"Unnamed contact"),type:String(p.relationshipType||"Unspecified"),interactions:count.get(p.id)||0,lastInteraction:recent.get(p.id)||"",evidence:personaV4Stage8Records(data,p.id,40).length}));
  return {nodes,total:all.length,hidden:Math.max(0,all.length-24),peopleCount:people.length,interactionCount:interactions.filter(i=>count.has(i?.personId)).length,
    kind:"recorded-user-contact-network",meaning:"A hub connects you to saved people. Line width reflects number of recorded interactions, not relationship quality. No person-to-person links are inferred."};
}

export function personaV4Stage8EvidenceCoverage(data,personId,today) {
  if(!personId)return null;
  const all=personaV4Stage8Records(data,personId,40);
  const byType={};
  for(const row of all)byType[row.store]=(byType[row.store]||0)+1;
  const date=/^\d{4}-\d{2}-\d{2}$/.test(String(today||""))?String(today).slice(0,10):"";
  const current=date?Date.parse(date+"T00:00:00Z"):NaN;
  const withDates=all.filter(x=>x.date);
  const recent=withDates.filter(x=>Number.isFinite(current)&&current-Date.parse(x.date+"T00:00:00Z")>=0&&current-Date.parse(x.date+"T00:00:00Z")<=90*86400000).length;
  const unknown=all.filter(x=>!x.date).length;
  return {total:all.length,recent,dated:withDates.length,undated:unknown,byType,
    note:"Counts describe the records visible here, not a personal trait, causal effect, or confidence score."};
}

export function personaV4Stage8DecisionPreview(data,personId,question,impact,reversibility) {
  if(!personId||!(data?.people||[]).some(p=>p.id===personId))return {ok:false,message:"Choose a person before reviewing evidence."};
  const prompt=String(question||"").trim();
  if(!prompt)return {ok:false,message:"Enter the decision question to inspect relevant recorded evidence."};
  const sources=personaV4Stage8Records(data,personId,40);
  const tokens=(prompt.toLocaleLowerCase().match(/[\p{L}\p{N}]{4,}/gu)||[]).filter(t=>!["should","would","could","about","with","that","from","what","this","make","person"].includes(t));
  const ranked=sources.map(s=>({...s,relevance:tokens.reduce((n,t)=>n+(s.text.toLocaleLowerCase().includes(t)?1:0),0)}))
    .sort((a,b)=>b.relevance-a.relevance||b.date.localeCompare(a.date)||a.id.localeCompare(b.id)).slice(0,6);
  const cautions=[];
  if(sources.length<3)cautions.push("Fewer than three related records are visible: evidence is limited.");
  if(["High","Critical"].includes(impact)&&["Difficult","Irreversible"].includes(reversibility))cautions.push("This is a high-impact, hard-to-reverse choice. Consider alternatives and an independent check.");
  if(!ranked.some(x=>x.relevance>0))cautions.push("No direct text overlap with this question was found; listed records are context only.");
  return {ok:true,personId,question:prompt,impact:String(impact||""),reversibility:String(reversibility||""),records:ranked,cautions,
    note:"This preview presents recorded context. It does not recommend a decision or predict another person's behavior."};
}
