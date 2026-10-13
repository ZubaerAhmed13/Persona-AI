import { personaCalendarDay, personaAddCalendarDays } from "./today.mjs";

export function personaV4TaskDay(item, kind) {
  if (!item || typeof item!=="object") return "";
  const raw = kind==="commitment" ? (item.expectedCompletion || item.dueDate) : kind==="memory" ? item.reminderDate : item.dueDate;
  return personaCalendarDay(raw);
}

export function personaV4TaskBuckets(data, today, personId=null) {
  const validToday=personaCalendarDay(today);
  const buckets={overdue:[],today:[],upcoming:[],unscheduled:[],snoozed:[],completed:[],cancelled:[]};
  if (!validToday) return buckets;
  for(const [store,kind] of [["followUps","followUp"],["commitments","commitment"],["memories","memory"]]) {
    const records=Array.isArray(data?.[store])?data[store]:[];
    for(const r of records) {
      if(!r || typeof r.id!=="string" || (personId && r.personId!==personId))continue;
      const status=String(r.status || "").toLowerCase();
      const completed=r.completed===true || ["done","completed","archived"].includes(status);
      const cancelled=r.cancelled===true||status==="cancelled";
      const due=personaV4TaskDay(r,kind);
      const text=String(kind==="followUp"?(r.text||r.title||r.description||"Follow-up"):kind==="commitment"?(r.commitment||r.description||"Commitment"):(r.info||r.text||"Memory reminder"));
      const item={id:r.id,kind,personId:r.personId||"",text,due,status};
      let category;
      if(cancelled)category="cancelled";
      else if(completed)category="completed";
      else if(kind==="followUp"&&status==="snoozed"&&due>validToday)category="snoozed";
      else if(!due)category="unscheduled";
      else if(due<validToday)category="overdue";
      else if(due===validToday)category="today";
      else category="upcoming";
      buckets[category].push(item);
    }
  }
  for(const [name,items] of Object.entries(buckets)) items.sort((a,b)=>{
    const dateA=a.due||"9999-12-31",dateB=b.due||"9999-12-31";
    return dateA.localeCompare(dateB) || String(a.kind).localeCompare(String(b.kind)) || a.id.localeCompare(b.id);
  });
  return buckets;
}

export function personaV4WeeklyPlan(data,today,personId=null) {
  const groups=personaV4TaskBuckets(data,today,personId);
  if(!personaCalendarDay(today))return {counts:{overdue:0,dueToday:0,nextSevenDays:0,unscheduled:0,postponed:0,completed:0},next:[]};
  const limit=personaAddCalendarDays(today,7);
  const coming=groups.upcoming.filter(x=>x.due<=limit);
  return {counts:{
    overdue:groups.overdue.length,dueToday:groups.today.length,nextSevenDays:coming.length,
    unscheduled:groups.unscheduled.length,postponed:groups.snoozed.length,completed:groups.completed.length
  },next:[...groups.overdue,...groups.today,...coming].slice(0,10)};
}

export function personaV4ValidateTaskDate(input) {
  const valid=personaCalendarDay(input);
  if(!valid || String(input).slice(0,10)!==valid)return "";
  return valid;
}
