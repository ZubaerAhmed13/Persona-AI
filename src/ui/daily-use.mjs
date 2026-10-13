import { personaV4uxDirectory } from "../domain/daily-use.mjs";

export function personaV4uxCard(p){
 const name=String(p.name||"Unnamed person"),id=esc2(p.id);
 return '<article class="card person-card v4ux-person-card" data-action="viewPerson" data-arg="'+id+'" aria-label="Person: '+esc2(name)+'">'+
  '<div class="v4ux-person-card-top"><div class="avatar-lg" aria-hidden="true" style="background:'+colorFor(name)+'">'+esc2(initials(name))+'</div>'+
  '<div class="v4ux-person-identity"><strong class="person-name">'+esc2(name)+'</strong><p>'+
  esc2([p.relationshipType,p.organization].filter(Boolean).join(" · ")||"Relationship not specified")+'</p>'+
  (p.alias?'<small>Also known as '+esc2(p.alias)+'</small>':"")+'</div></div>'+
  '<div class="v4ux-person-actions"><button class="btn btn-primary btn-sm" type="button" data-action="viewPerson" data-arg="'+id+'">Open profile</button>'+
  '<button class="btn btn-sm" type="button" data-action="quickCapture" data-arg="'+id+'">Log interaction</button></div></article>';
}

export function personaV4uxDirectoryHTML() {
 const s=getState(),people=peopleList(),q=s._v4uxPeopleQuery||"",sort=s._v4uxPeopleSort||"name",limit=s._v4uxPeopleLimit||36;
 const x=personaV4uxDirectory(people,s.data.interactions,q,sort,limit);
 const cards=x.items.map(personaV4uxCard).join("");
 return `<div class="page-head"><div><div class="page-title">People</div><div class="page-desc">Find a person, remember the context, and log what matters.</div></div><div class="head-actions"><button class="btn btn-primary" data-action="addPerson">${icon("plus",15)} Add person</button></div></div>
 <section class="v4ux-directory" aria-label="Search saved people">
 <div class="v4ux-directory-controls">
  <div class="v4ux-directory-search"><label for="v4uxPeopleQuery">Find a person</label><input class="input" type="search" id="v4uxPeopleQuery" placeholder="Name, nickname, organisation…" autocomplete="off" value="${esc2(q)}"></div>
  <div class="v4ux-directory-sort"><label for="v4uxPeopleSort">Order by</label><select class="select" id="v4uxPeopleSort"><option value="name" ${sort==="name"?"selected":""}>Name A–Z</option><option value="recent" ${sort==="recent"?"selected":""}>Recently interacted</option></select></div>
 </div><p class="v4ux-result-count" id="v4uxPeopleCount" role="status" aria-live="polite">${x.shown} of ${x.matched} matching people${x.matched!==x.total?" · "+x.total+" total":""}</p>
 <div id="v4uxPeopleResults">${x.matched?`<div id="v4uxPeopleGrid" class="grid v4ux-people-grid">${cards}</div>${x.more?'<button class="btn v4ux-more" data-action="v4uxPeopleMore" type="button">Show more people</button>':""}`:people.length?`<div class="v4ux-empty"><p>No people match that search.</p><button class="btn" type="button" data-action="v4uxClearPeople">Clear search</button></div>`:`<div class="v4ux-empty"><p>No people saved yet. Add your first contact to begin.</p><button class="btn btn-primary" type="button" data-action="addPerson">Add a person</button></div>`}</div>
 </section>`;
}

export function personaV4uxRefreshDirectory() {
 const container=document.getElementById("v4uxPeopleResults"),counter=document.getElementById("v4uxPeopleCount");
 if(!container||!counter)return;
 const s=getState();
 const selection=personaV4uxDirectory(peopleList(),s.data.interactions,s._v4uxPeopleQuery||"",s._v4uxPeopleSort||"name",s._v4uxPeopleLimit||36);
 counter.textContent=selection.shown+" of "+selection.matched+" matching people"+(selection.matched!==selection.total?" · "+selection.total+" total":"");
 container.innerHTML=selection.matched?
  '<div id="v4uxPeopleGrid" class="grid v4ux-people-grid">'+selection.items.map(personaV4uxCard).join("")+'</div>'+
  (selection.more?'<button class="btn v4ux-more" data-action="v4uxPeopleMore" type="button">Show more people</button>':""):
  '<div class="v4ux-empty"><p>'+((s.data.people||[]).length?"No people match that search.":"No people saved yet.")+'</p><button class="btn" data-action="v4uxClearPeople">Clear search</button></div>';
}

export function personaV4uxBindDirectory() {
 const search=document.getElementById("v4uxPeopleQuery"),sort=document.getElementById("v4uxPeopleSort");
 if(!search||!sort)return;
 search.addEventListener("input",()=>{
   const s=getState();s._v4uxPeopleQuery=search.value.slice(0,120);s._v4uxPeopleLimit=36;personaV4uxRefreshDirectory();
 });
 sort.addEventListener("change",()=>{
   const s=getState();s._v4uxPeopleSort=sort.value==="recent"?"recent":"name";s._v4uxPeopleLimit=36;personaV4uxRefreshDirectory();
 });
}

export function personaV4uxDirectoryMore(){
 const s=getState();s._v4uxPeopleLimit=Math.min(400,(s._v4uxPeopleLimit||36)+36);personaV4uxRefreshDirectory();
}

export function personaV4uxDirectoryClear(){
 const s=getState();s._v4uxPeopleQuery="";s._v4uxPeopleLimit=36;
 const el=document.getElementById("v4uxPeopleQuery");if(el){el.value="";personaV4uxRefreshDirectory();el.focus();}
}

export function personaV4uxEnhance(view) {
 if(view==="dashboard" && (getState().data.people||[]).length){
  const root=document.getElementById("view"),copilot=root?.querySelector("#copQuickInput")?.closest(".card");
  if(copilot&&copilot.parentElement===root&&copilot.nextElementSibling){
   const details=document.createElement("details");details.className="v4ux-dashboard-extras";
   const title=document.createElement("summary");title.className="v4ux-extras-summary";
   title.innerHTML='<span><strong>More insights and tools</strong><small>Relationship briefing, decision support and detailed analysis</small></span><span aria-hidden="true" class="v4ux-extras-chevron">⌄</span>';
   details.appendChild(title);
   while(copilot.nextSibling)details.appendChild(copilot.nextSibling);
   root.appendChild(details);
   details.open=Boolean(getState()._v4uxShowDashboardExtras);
   details.addEventListener("toggle",()=>getState()._v4uxShowDashboardExtras=details.open);
  }
 }
 if(view==="people" && getState().focusPersonId){
  const row=document.querySelector("#view .person-header .head-actions");
  if(row&&!row.querySelector(".v4ux-profile-more")){
   const primary=new Set(["personBrief360","quickCapture","addMemory"]);
   const advanced=[...row.querySelectorAll(":scope > button[data-action]")].filter(btn=>!primary.has(btn.dataset.action));
   if(advanced.length){
    const extra=document.createElement("details");extra.className="v4ux-profile-more";
    const summary=document.createElement("summary");summary.textContent="More actions ("+advanced.length+")";
    const actions=document.createElement("div");actions.className="v4ux-profile-extra-buttons";
    advanced.forEach(btn=>actions.appendChild(btn));
    extra.append(summary,actions);row.appendChild(extra);
   }
  }
 }
}

export function personaV4uxInitSearchKeyboard(){
 const input=document.getElementById("globalSearchInput"),list=document.getElementById("searchResults");
 if(!input||!list||input.dataset.v4uxKeySupport)return;
 input.dataset.v4uxKeySupport="true";
 list.setAttribute("aria-label","Search results");
 list.setAttribute("role","region");
 input.setAttribute("aria-controls","searchResults");
 document.addEventListener("keydown",e=>{
  if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&!e.altKey&&e.key.toLowerCase()==="k"){
   if(document.querySelector("#modalRoot .modal-backdrop"))return;
   e.preventDefault();input.focus();input.select();return;
  }
 });
 const results=()=>list.hidden?[]:[...list.querySelectorAll("[data-sr]")];
 input.addEventListener("keydown",e=>{
  if(e.key==="Escape"){list.hidden=true;return;}
  if(!["ArrowDown","ArrowUp","Enter"].includes(e.key))return;
  const rows=results();if(!rows.length)return;
  e.preventDefault();
  if(e.key==="Enter")rows[0].click();
  else {rows.forEach(row=>{row.setAttribute("tabindex","-1");row.setAttribute("role","button")});rows[e.key==="ArrowDown"?0:rows.length-1].focus();}
 });
 list.addEventListener("keydown",e=>{
  const row=e.target.closest("[data-sr]");if(!row)return;
  if(["Enter"," "].includes(e.key)){e.preventDefault();row.click();return;}
  if(e.key==="Escape"){e.preventDefault();list.hidden=true;input.focus();return;}
  if(!["ArrowDown","ArrowUp"].includes(e.key))return;
  const rows=results(),idx=rows.indexOf(row);if(idx===-1)return;
  e.preventDefault();rows[(idx+(e.key==="ArrowDown"?1:-1)+rows.length)%rows.length].focus();
 });
}
