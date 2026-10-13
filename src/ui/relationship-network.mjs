import {personaV4Stage8Records,personaV4Stage8Network,personaV4Stage8EvidenceCoverage,personaV4Stage8DecisionPreview} from "../domain/relationship-network.mjs";

export function personaV4Stage8Escape(x){
  return String(x??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

export function personaV4Stage8Graph(net,selectedId=""){
  const w=720,h=410,cx=355,cy=200;
  const nodes=net.nodes||[];
  const max=Math.max(1,...nodes.map(x=>x.interactions));
  const paths=nodes.map((nd,i)=>{
    const ring=i<12?0:1,ringPos=ring===0?i:i-12,amount=Math.min(12,nodes.length-ring*12);
    const angle=(ringPos/Math.max(1,amount))*Math.PI*2-Math.PI/2;
    const radius=ring===0?117:183;
    return {...nd,x:+(cx+Math.cos(angle)*radius).toFixed(2),y:+(cy+Math.sin(angle)*(radius*.85)).toFixed(2)};
  });
  return '<svg viewBox="0 0 '+w+' '+h+'" role="img" aria-label="Diagram of recorded contacts connected only to you" class="v4s8-map">'+
    paths.map(n=>'<line x1="'+cx+'" y1="'+cy+'" x2="'+n.x+'" y2="'+n.y+'" stroke="var(--accent)" opacity="'+(n.interactions?".43":".15")+'" stroke-width="'+(1+4*n.interactions/max).toFixed(1)+'"></line>').join("")+
    '<circle cx="'+cx+'" cy="'+cy+'" r="35" fill="var(--accent)" opacity=".95"></circle><text x="'+cx+'" y="'+(cy+4)+'" text-anchor="middle" fill="white" font-size="13" font-weight="bold">You</text>'+
    paths.map(n=>'<g role="button" tabindex="0" data-action="v4NetworkSelect" data-arg="'+personaV4Stage8Escape(n.id)+'" class="v4s8-map-node '+(n.id===selectedId?"v4s8-map-selected":"")+'" aria-label="Select '+personaV4Stage8Escape(n.name)+', '+n.interactions+' recorded interactions">'+
       '<circle cx="'+n.x+'" cy="'+n.y+'" r="'+(n.id===selectedId?19:15)+'" fill="'+(n.id===selectedId?"var(--accent)":"var(--bg-raise)")+'" stroke="var(--accent)" stroke-width="'+(n.id===selectedId?3:1.6)+'"></circle>'+
       '<text x="'+n.x+'" y="'+(n.y+29)+'" text-anchor="middle" font-size="11" fill="var(--text-strong)">'+personaV4Stage8Escape(n.name.length>17?n.name.slice(0,16)+"…":n.name)+'</text><title>'+personaV4Stage8Escape(n.name)+": "+n.interactions+' recorded interactions</title></g>').join("")+
    '</svg>';
}

export function personaV4Stage8EvidenceRow(r){
  return '<button type="button" class="v4s8-source" data-action="v4NetworkSource" data-arg="'+personaV4Stage8Escape(r.store+"|"+r.id)+"|"+personaV4Stage8Escape(r.personId)+'"><span class="v4s8-source-meta">'+
    personaV4Stage8Escape(r.store)+" · "+personaV4Stage8Escape(r.date||"Undated")+'</span><span>'+personaV4Stage8Escape(r.text)+'</span></button>';
}

export function personaV4Stage8NetworkHTML(data,search="",selectedId=""){
  const net=personaV4Stage8Network(data,search);
  const selected=net.nodes.find(n=>n.id===selectedId)||null;
  const evidence=selected?personaV4Stage8Records(data,selected.id,8):[];
  const coverage=selected?personaV4Stage8EvidenceCoverage(data,selected.id,""):null;
  return '<div class="v4s8-network"><div class="v4s8-toolbar"><label class="v4s8-search-label" for="v4s8Search">Find contact by name, organization or saved relationship type<input id="v4s8Search" class="input" type="search" maxlength="120" value="'+personaV4Stage8Escape(search)+'" placeholder="Search saved people"></label>'+
    '<span class="v4s8-muted">'+net.total+' matching contacts'+(net.hidden?" · Showing first 24 alphabetically":"")+'</span></div>'+
    '<div class="v4s8-network-grid"><div class="v4s8-figure">'+personaV4Stage8Graph(net,selectedId)+
    '<p class="v4s8-explainer">'+personaV4Stage8Escape(net.meaning)+'</p></div>'+
    '<div class="v4s8-directory" aria-label="Saved contacts">'+(net.nodes.length?net.nodes.map(n=>'<button class="v4s8-person-row '+(n.id===selectedId?"active":"")+'" data-action="v4NetworkSelect" data-arg="'+personaV4Stage8Escape(n.id)+'" type="button" aria-pressed="'+String(n.id===selectedId)+'">'+
       '<span class="v4s8-name">'+personaV4Stage8Escape(n.name)+'</span><span class="v4s8-muted">'+n.interactions+' recorded interactions · '+personaV4Stage8Escape(n.type)+'</span></button>').join(""):'<p class="v4s8-muted">No contacts match. Try another search or add a person.</p>')+'</div></div>'+
    '<div id="v4s8Selection" class="v4s8-detail">'+(selected?'<div class="v4s8-detail-head"><div><h3>'+personaV4Stage8Escape(selected.name)+'</h3><p class="v4s8-muted">'+selected.interactions+' saved interactions · Last recorded interaction '+personaV4Stage8Escape(selected.lastInteraction||"unknown")+'</p></div>'+
      '<button type="button" class="btn btn-sm" data-action="viewPerson" data-arg="'+personaV4Stage8Escape(selected.id)+'">Open full profile</button></div>'+
      '<p class="v4s8-muted">Recent source records (up to 8). '+coverage.total+' displayed in the evidence selector (maximum 40). No automated relationship quality score.</p>'+
      (evidence.length?'<div class="v4s8-sources">'+evidence.map(personaV4Stage8EvidenceRow).join("")+'</div>':'<p class="v4s8-muted">No source records saved for this contact yet.</p>'):
      '<p class="v4s8-muted">Select a contact on the diagram or list to explore their original recorded evidence.</p>')+'</div></div>';
}

export function personaV4Stage8Mount(view){
  if(!["relationships","decisionlab","patterns"].includes(view))return;
  const root=document.getElementById("view"),head=root?.querySelector(".page-head");
  if(!head)return;
  const section=document.createElement("section");
  section.className="card v4s8-panel";section.id="v4s8Panel";
  if(view==="relationships"){
    section.setAttribute("aria-label","Interactive relationship network");
    section.innerHTML='<div class="v4s8-header"><h2>Explore your contact network</h2><span>Based on recorded interactions · local only</span></div>'+
      '<div id="v4s8NetworkRoot">'+personaV4Stage8NetworkHTML(getState().data,getState()._v4s8Filter||"",getState()._v4s8Selected||"")+'</div>';
    head.after(section);
    // Retain classic renderer as a collapsible alternative rather than duplicating charts.
    const classic=root.querySelector(".network-wrap")?.closest(".card");
    if(classic){
      const details=document.createElement("details");details.className="v4s8-classic";
      const summary=document.createElement("summary");summary.textContent="Show original static network overview";
      classic.before(details);details.append(summary,classic);
    }
    const input=section.querySelector("#v4s8Search");
    input?.addEventListener("input",()=>{
      const s=getState();s._v4s8Filter=input.value;
      personaV4Stage8UpdateNetwork();
    });
    section.querySelectorAll('.v4s8-map-node').forEach(g=>g.addEventListener("keydown",e=>{
      if(e.key==="Enter"||e.key===" "){e.preventDefault();g.click();}
    }));
    return;
  }
  if(view==="decisionlab"){
    section.setAttribute("aria-label","Decision evidence preview");
    section.innerHTML='<div class="v4s8-header"><h2>Evidence before a decision</h2><span>Read-only · no prediction of someone’s intentions</span></div>'+
      '<p class="v4s8-muted">Review the sources and uncertainty for the person and question selected in Decision Lab. This does not change your decision or save a new record.</p>'+
      '<button class="btn btn-sm" type="button" data-action="v4DecisionEvidence">Preview recorded evidence</button><div id="v4s8DecisionOutput" aria-live="polite"></div>';
    head.after(section);return;
  }
  const pid=curPersonId();
  const coverage=personaV4Stage8EvidenceCoverage(getState().data,pid,todayLocal());
  section.setAttribute("aria-label","Evidence provenance");
  section.innerHTML='<div class="v4s8-header"><h2>Evidence coverage and limits</h2><span>No person or character ranking</span></div>'+
    (coverage?'<p class="v4s8-muted">Up to 40 recent saved source records for the selected person: '+coverage.total+' displayed · '+coverage.recent+' dated within 90 days · '+coverage.undated+' without recorded dates.</p>':
      '<p class="v4s8-muted">Choose a person from the top context selector to inspect their recorded sources.</p>')+
    '<p class="v4s8-muted">Patterns depend on the records available. Sparse or context-specific evidence cannot prove motivation or causation.</p>';
  head.after(section);
}

export function personaV4Stage8UpdateNetwork(){
  const section=document.getElementById("v4s8NetworkRoot");
  if(!section)return;
  const s=getState(),input=document.getElementById("v4s8Search");
  const focused=document.activeElement===input;
  const caret=focused?input.selectionStart:null;
  section.innerHTML=personaV4Stage8NetworkHTML(s.data,s._v4s8Filter||"",s._v4s8Selected||"");
  const next=section.querySelector("#v4s8Search");
  next?.addEventListener("input",()=>{s._v4s8Filter=next.value;personaV4Stage8UpdateNetwork();});
  section.querySelectorAll(".v4s8-map-node").forEach(g=>g.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();g.click();}}));
  if(focused&&next){next.focus();if(caret!==null)next.setSelectionRange(caret,caret);}
}

export function personaV4Stage8SelectPerson(id){
  if(!(getState().data.people||[]).some(p=>p.id===id))return;
  getState()._v4s8Selected=id;personaV4Stage8UpdateNetwork();
}

export function personaV4Stage8OpenRecord(arg){
  const [store,id,personId]=String(arg||"").split("|");
  if(!["interactions","observations","memories","commitments","followUps","decisions"].includes(store)||!id||!personId)return;
  const r=(getState().data[store]||[]).find(x=>x.id===id&&x.personId===personId);
  if(!r)return;
  const rows=personaV4Stage8Records(getState().data,personId,40),entry=rows.find(x=>x.store===store&&x.id===id);
  const title=entry?.text||"Recorded item",extra=typeof r.interpretation==="string"?r.interpretation:"";
  const body='<p class="v4s8-source-record">'+personaV4Stage8Escape(title)+'</p>'+
     (extra?'<div class="v4s8-inference"><strong>Saved interpretation (not independently verified)</strong><p>'+personaV4Stage8Escape(extra)+'</p></div>':"")+
     '<p class="v4s8-muted">Original record: '+personaV4Stage8Escape(store)+" · "+personaV4Stage8Escape(id)+'</p>';
  const btn=document.createElement("button");btn.className="btn btn-primary";btn.textContent="Close";
  const m=openModal({title:"Source record",subtitle:"Local · original evidence",body,footer:btn});
  btn.onclick=closeModal;
}

export function personaV4Stage8DecisionEvidence(){
  const root=document.getElementById("view");
  const selected=root?.querySelector("#dl_person")?.value||"";
  const question=root?.querySelector("#dl_decision")?.value||"";
  const impact=root?.querySelector("#dl_impact")?.value||"";
  const rev=root?.querySelector("#dl_rev")?.value||"";
  const out=root?.querySelector("#v4s8DecisionOutput");
  if(!out)return;
  const result=personaV4Stage8DecisionPreview(getState().data,selected,question,impact,rev);
  if(!result.ok){out.innerHTML='<p class="v4s8-muted">'+personaV4Stage8Escape(result.message)+'</p>';return;}
  out.innerHTML='<div class="v4s8-review"><p><strong>Question:</strong> '+personaV4Stage8Escape(result.question)+'</p>'+
    '<p class="v4s8-muted">Impact: '+personaV4Stage8Escape(result.impact)+' · Reversibility: '+personaV4Stage8Escape(result.reversibility)+'</p>'+
    (result.cautions.length?'<ul>'+result.cautions.map(x=>'<li>'+personaV4Stage8Escape(x)+'</li>').join("")+'</ul>':"")+
    '<h3>Relevant recorded context (up to 6)</h3>'+result.records.map(personaV4Stage8EvidenceRow).join("")+
    '<p class="v4s8-muted">'+personaV4Stage8Escape(result.note)+'</p></div>';
}
