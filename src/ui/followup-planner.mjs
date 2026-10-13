import { personaCalendarDay, personaAddCalendarDays, personaRecordClosed } from "../domain/today.mjs";
import { personaV4TaskDay, personaV4TaskBuckets, personaV4WeeklyPlan, personaV4ValidateTaskDate } from "../domain/followup-planner.mjs";

export function personaV4Stage6TaskRow(item, extra="") {
  const action=item.kind==="followUp"?"completeFollowUp":item.kind==="commitment"?"completeCommitment":"completeMemory";
  const type=item.kind==="followUp"?"Follow-up":item.kind==="commitment"?"Commitment":"Memory reminder";
  const edit=item.kind==="memory"?"":'<button class="btn btn-sm" data-action="v4RescheduleTask" data-arg="'+esc2(item.kind+"|"+item.id)+'">Change date</button>';
  const postpone=item.kind==="followUp" ? '<button class="btn btn-sm" data-action="v4SnoozeTask" data-arg="'+esc2(item.id)+'" data-days="3">+3d</button><button class="btn btn-sm" data-action="v4SnoozeTask" data-arg="'+esc2(item.id)+'" data-days="7">+7d</button>' : "";
  return '<div class="v4s6-row"><div class="v4s6-info"><span class="v4s6-type">'+type+'</span>'+
    '<strong>'+esc2(item.text)+'</strong><span class="v4s6-meta">'+esc2(item.personId?personName(item.personId):"General")+
    ' · '+esc2(item.due||"Unscheduled")+'</span></div>'+
    '<div class="v4s6-actions"><button class="btn btn-sm btn-primary" data-action="'+action+'" data-arg="'+esc2(item.id)+'">'+(item.kind==="memory"?"Reviewed":"Complete")+'</button>'+
    edit+postpone+(item.personId?'<button class="btn btn-sm" data-action="viewPerson" data-arg="'+esc2(item.personId)+'">Person</button>':"")+'</div></div>';
}

export function personaV4Stage6RenderFollowUps() {
  const s=getState();
  const selectedPerson=s.contextPersonId==="all"?null:s.contextPersonId;
  const all=personaV4TaskBuckets(s.data,todayLocal(),selectedPerson);
  const only=(name)=>all[name].filter(x=>x.kind==="followUp");
  const counts={overdue:only("overdue").length,today:only("today").length,upcoming:only("upcoming").length,
    snoozed:only("snoozed").length,unscheduled:only("unscheduled").length,
    completed:only("completed").length,cancelled:only("cancelled").length};
  const tabs=[["due","Due now",counts.overdue+counts.today],["upcoming","Upcoming",counts.upcoming],["snoozed","Snoozed",counts.snoozed],
    ["unscheduled","Unscheduled",counts.unscheduled],["completed","Completed",counts.completed],["cancelled","Cancelled",counts.cancelled]];
  let tab=s._v4Stage6Tab||"due";
  if(!tabs.some(x=>x[0]===tab))tab="due";
  const items=tab==="due"?[...only("overdue"),...only("today")]:only(tab);
  const rows=items.map(item=>{
    if(tab==="completed"||tab==="cancelled")
      return '<div class="v4s6-row"><div class="v4s6-info"><strong>'+esc2(item.text)+'</strong><span class="v4s6-meta">'+esc2(item.personId?personName(item.personId):"General")+
        ' · '+esc2(item.due||"No due date")+'</span></div><div class="v4s6-actions"><button class="btn btn-sm" data-action="v4ReopenFollowUp" data-arg="'+esc2(item.id)+'">Reopen</button></div></div>';
    return personaV4Stage6TaskRow(item);
  }).join("");
  return '<div class="page-head"><div><div class="page-title">Follow-ups</div><div class="page-desc">Review what is due, plan upcoming conversations, and choose when to follow up. Stored locally, no background push.</div></div>'+
    '<div class="head-actions"><button class="btn btn-primary" data-action="addFollowUp">+ New follow-up</button></div></div>'+
    '<div class="v4-followup-grid" role="group" aria-label="Follow-up overview">'+
    '<div class="v4-followup-card"><strong>'+String(counts.overdue)+'</strong><span>Overdue</span></div>'+
    '<div class="v4-followup-card"><strong>'+String(counts.today)+'</strong><span>Today</span></div>'+
    '<div class="v4-followup-card"><strong>'+String(counts.upcoming+counts.snoozed)+'</strong><span>Scheduled later</span></div></div>'+
    '<div class="v4s6-tabs" role="group" aria-label="Filter follow-ups">'+
    tabs.map(([id,label,count])=>'<button class="btn btn-sm '+(tab===id?"btn-primary":"")+'" data-action="v4FollowUpTab" data-arg="'+id+'" aria-pressed="'+String(tab===id)+'">'+label+' ('+count+')</button>').join("")+'</div>'+
    (rows?'<div class="v4-followup-list">'+rows+'</div>':'<div class="card empty"><h3>No follow-ups in this category</h3><p>Choose another filter or schedule your next conversation.</p></div>')+
    '<p class="v4s6-note">Overdue indicates a missed recorded date, not a judgment about anyone. Snoozed items appear in their own category until due.</p>';
}

export function personaV4Stage6MountPlanner(view) {
  if(!["commitments","weekly","monthly"].includes(view))return;
  const root=document.getElementById("view");
  const head=root?.querySelector(".page-head");
  if(!head)return;
  const today=todayLocal();
  const state=getState();
  const pid=state.contextPersonId==="all"?null:state.contextPersonId;
  const groups=personaV4TaskBuckets(state.data,today,pid);
  const plan=personaV4WeeklyPlan(state.data,today,pid);
  let rows=[];
  if(view==="commitments")rows=[...groups.overdue,...groups.today,...groups.upcoming,...groups.unscheduled].filter(x=>x.kind==="commitment").slice(0,8);
  else rows=plan.next;
  const panel=document.createElement("section");
  panel.className="card v4s6-panel";
  panel.setAttribute("aria-label",view==="commitments"?"Commitment priorities":"Weekly planning overview");
  panel.innerHTML='<div class="v4s6-heading"><h2>'+(view==="commitments"?"Commitment priorities":"This week’s plan")+'</h2>'+
    '<span>Read-only summary · local records</span></div>'+
    '<div class="v4s6-metrics"><div><strong>'+plan.counts.overdue+'</strong><span>Overdue</span></div>'+
    '<div><strong>'+plan.counts.dueToday+'</strong><span>Due today</span></div>'+
    '<div><strong>'+plan.counts.nextSevenDays+'</strong><span>Next 7 days</span></div>'+
    '<div><strong>'+plan.counts.unscheduled+'</strong><span>Unscheduled</span></div></div>'+
    (rows.length?'<div class="v4s6-list">'+rows.map(x=>personaV4Stage6TaskRow(x)).join("")+'</div>':
      '<p class="muted">No open tasks in this view. Record a follow-up or commitment when there is something to remember.</p>')+
    '<p class="v4s6-note">This overview is based on stored dates and does not send notifications while the app is closed.</p>';
  head.after(panel);
}

export async function personaV4Stage6SnoozeFollowUp(id,days) {
  const task=byId("followUps",id);
  const amount=Number(days);
  if(!task || personaRecordClosed(task) || ![3,7].includes(amount))return;
  const today=todayLocal();
  const due=personaCalendarDay(task.dueDate);
  const start=due>today?due:today;
  const next=personaAddCalendarDays(start,amount);
  if(!next)return;
  try {
    await update("followUps",id,{status:"snoozed",dueDate:next+"T12:00:00"});
    toast("Follow-up postponed until "+next+".","ok");
    render();
  }catch(e){toast("The follow-up could not be postponed.","bad");}
}

export async function personaV4Stage6ReopenFollowUp(id) {
  const task=byId("followUps",id);
  if(!task)return;
  try{
    await update("followUps",id,{completed:false,cancelled:false,status:"active"});
    toast("Follow-up reopened.","ok");render();
  }catch(e){toast("Could not reopen the follow-up.","bad");}
}

export function personaV4Stage6RescheduleTask(arg) {
  const [kind,id]=String(arg||"").split("|");
  if(!["followUp","commitment"].includes(kind)||!id)return;
  const store=kind==="followUp"?"followUps":"commitments";
  const task=byId(store,id);
  if(!task || personaRecordClosed(task))return;
  const current=personaV4TaskDay(task,kind);
  const picker='<p class="muted">Change the planned date. This updates the existing record and keeps its original identity and history.</p>'+
    '<div class="field"><label for="v4s6Date">New due date</label><input id="v4s6Date" class="input" type="date" value="'+esc2(current||todayLocal())+'" required></div>';
  const cancel=document.createElement("button");cancel.className="btn";cancel.textContent="Cancel";
  const save=document.createElement("button");save.className="btn btn-primary";save.textContent="Save date";
  const foot=document.createElement("div");foot.append(cancel,save);
  const modal=openModal({title:"Reschedule "+(kind==="commitment"?"commitment":"follow-up"),subtitle:"Review before saving",body:picker,footer:foot});
  cancel.onclick=closeModal;
  save.onclick=async()=>{
    const day=personaV4ValidateTaskDate(modal.bodyEl.querySelector("#v4s6Date")?.value||"");
    if(!day){toast("Select a valid date.","warn");return;}
    save.disabled=true;
    const patch=kind==="followUp"?{dueDate:day+"T12:00:00",status:"active"}:
      (task.expectedCompletion?{expectedCompletion:day+"T12:00:00"}:{dueDate:day+"T12:00:00"});
    try{await update(store,id,patch);closeModal();toast("Date changed to "+day+".","ok");render();}
    catch(e){save.disabled=false;toast("Could not save the new date.","bad");}
  };
}
