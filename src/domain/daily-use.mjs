// Read-only, bounded People directory selector for fast everyday use. No user data writes.
export function personaV4uxDirectory(people,interactions,query="",order="name",limit=36) {
 const all=Array.isArray(people)?people.filter(p=>p&&typeof p.id==="string"):[];
 const q=String(query||"").trim().normalize("NFKC").toLocaleLowerCase();
 const activity=new Map();
 if(order==="recent"){
  for(const r of Array.isArray(interactions)?interactions:[]){
   if(!r||typeof r.personId!=="string")continue;
   const day=String(r.date||r.createdAt||"").slice(0,10);
   if(/^\d{4}-\d{2}-\d{2}$/.test(day)&&day>(activity.get(r.personId)||""))activity.set(r.personId,day);
  }
 }
 const matched=all.filter(p=>[p.name,p.alias,p.organization,p.relationshipType].some(x=>
  typeof x==="string"&&x.normalize("NFKC").toLocaleLowerCase().includes(q)));
 matched.sort((a,b)=>{
  if(order==="recent"){const diff=(activity.get(b.id)||"").localeCompare(activity.get(a.id)||"");if(diff)return diff;}
  return String(a.name||"").localeCompare(String(b.name||""),undefined,{sensitivity:"base"})||a.id.localeCompare(b.id);
 });
 const safeLimit=Number.isFinite(+limit)?Math.max(1,Math.min(400,+limit)):36;
 return {items:matched.slice(0,safeLimit),total:all.length,matched:matched.length,shown:Math.min(safeLimit,matched.length),more:matched.length>safeLimit};
}
