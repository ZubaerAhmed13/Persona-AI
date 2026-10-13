import { personaV4NormalizeContact, personaV4PersonMatches, personaV4ParseContactCSV, personaV4ContactCSVPreview } from "../domain/smart-capture.mjs";
import { personaV4EscapeActivity } from "./person-activity.mjs";

export function personaV4ImportContactsAtomic(db, incoming, makeId, schemaVersion, timestamp) {
  return new Promise((resolve, reject) => {
    if (!Array.isArray(incoming) || !incoming.length || incoming.length > 500) {
      reject(new Error("Select between 1 and 500 valid contacts.")); return;
    }
    const trans = db.transaction(["people","auditLog"],"readwrite");
    const store = trans.objectStore("people");
    const log = trans.objectStore("auditLog");
    let records = [], error = null;
    trans.oncomplete = () => resolve(records);
    trans.onabort = () => reject(error || trans.error || new Error("Contact import was rolled back."));
    trans.onerror = () => { if (!error) error = trans.error || new Error("Contact import failed."); };
    const req = store.getAll();
    req.onsuccess = () => {
      try {
        const existing = req.result || [];
        const seen = new Set(existing.flatMap(p => [p.name,p.alias].map(personaV4NormalizeContact).filter(Boolean)));
        const ids = new Set(existing.map(p => p.id));
        for (const row of incoming) {
          const person = row.person || row;
          const name = String(person.name || "").trim();
          const key = personaV4NormalizeContact(name);
          if (!key || name.length > 120 || seen.has(key)) throw new Error("Contact already exists or is invalid: " + name.slice(0,100));
          seen.add(key);
          let id = makeId("people");
          if (ids.has(id)) throw new Error("Generated ID collision; import rolled back.");
          ids.add(id);
          const record = {
            id, schemaVersion, createdAt:timestamp, updatedAt:timestamp,
            name, alias:String(person.alias || "").slice(0,120), organization:String(person.organization || "").slice(0,200),
            relationshipType:String(person.relationshipType || "").slice(0,120),
            notes:String(person.notes || "").slice(0,2000),
            communicationPreferences:String(person.communicationPreferences || "").slice(0,300),
            importantDates:String(person.importantDates || "").slice(0,300),
            tags:[], interests:[]
          };
          records.push(record);
          store.add(record);
          log.add({id:makeId("audit"),schemaVersion,createdAt:timestamp,updatedAt:timestamp,
            store:"people",action:"import",recordId:id,personId:null,at:timestamp});
        }
      } catch (e) {
        error = e;
        trans.abort();
      }
    };
  });
}

export function personaV4OpenContactsCSV() {
  const content = `<p class="muted">Import only contacts you have permission to record. The CSV is read on this device only. Existing people are never overwritten or automatically merged.</p>
    <div class="field"><label for="v4csvFile">Contacts CSV file (max 1 MB, 500 contacts)</label><input class="input" type="file" id="v4csvFile" accept=".csv,text/csv,text/plain"></div>
    <p class="hint">Required column: Name or Full Name. Optional: Alias, Organization, Relationship, Notes, Communication Preferences, Important Dates. Duplicate names or aliases are skipped.</p>
    <div id="v4csvPreview" role="status" aria-live="polite">Choose a CSV file to preview its contacts.</div>`;
  const cancel = document.createElement("button");
  cancel.className = "btn"; cancel.textContent = "Cancel";
  const apply = document.createElement("button");
  apply.className = "btn btn-primary"; apply.textContent = "Import selected"; apply.disabled = true;
  const footer = document.createElement("div");
  footer.append(cancel,apply);
  const modal = openModal({title:"Import contacts from CSV", subtitle:"Review before saving · local only",body:content,footer,size:"modal-lg"});
  cancel.onclick = closeModal;
  const fileEl = modal.bodyEl.querySelector("#v4csvFile");
  const preview = modal.bodyEl.querySelector("#v4csvPreview");
  let prepared = [];
  const checked = () => [...modal.bodyEl.querySelectorAll("[data-csv-include]:checked")]
    .map(el => prepared[Number(el.value)]).filter(Boolean);
  fileEl.addEventListener("change",async () => {
    apply.disabled = true; prepared = [];
    const file = fileEl.files?.[0];
    if (!file) return;
    if (file.size > 1048576) { preview.textContent = "File is larger than 1 MB."; return; }
    preview.textContent = "Reading local CSV…";
    try {
      const parsed = personaV4ParseContactCSV(await file.text());
      prepared = personaV4ContactCSVPreview(parsed,getState().data.people);
      const usable = prepared.filter(r=>r.canImport).length;
      preview.innerHTML = `<p class="muted">${prepared.length} rows reviewed · ${usable} new contacts ready · ${prepared.length-usable} skipped. Review the selection before saving.</p>
       <div class="v4-csv-list">${prepared.map((r,i) => `<label class="v4-csv-row">
       <input type="checkbox" data-csv-include value="${i}" ${r.canImport?"checked":"disabled"} aria-label="Import row ${r.rowNumber}">
       <span><strong>${personaV4EscapeActivity(r.person.name || "(unnamed)")}</strong>
       <small>Row ${r.rowNumber}${r.person.organization?" · "+personaV4EscapeActivity(r.person.organization):""}</small>
       ${!r.canImport?`<small class="v4-csv-warning">${personaV4EscapeActivity([...r.issues,...r.duplicateExisting.map(x=>"Existing match: "+x),...(r.duplicateRow?["Repeated in CSV row "+r.duplicateRow]:[])].join("; "))}</small>`:""}
       </span></label>`).join("")}</div>`;
      apply.disabled = usable===0;
      preview.querySelectorAll("[data-csv-include]").forEach(el=>el.addEventListener("change",()=>apply.disabled=checked().length===0));
    } catch(e) {preview.textContent = "CSV rejected: "+e.message; prepared=[];}
  });
  apply.onclick = async () => {
    const selected = checked();
    if (!selected.length) return;
    apply.disabled = true;
    try {
      // Backup happens before any writes; import is one IndexedDB transaction.
      exportJSON();
      const imported = await personaV4ImportContactsAtomic(await openDb(),selected,uid,SCHEMA_VERSION,new Date().toISOString());
      await loadAll();
      syncContextSelect();
      closeModal();
      toast(imported.length+" contacts imported; a JSON backup was requested first.","ok","Import complete");
      navigate2("people");
    } catch(error) {
      apply.disabled = false;
      toast("Import not applied: "+(error?.message || "transaction aborted"),"bad","No contacts imported");
    }
  };
}

export function personaV4MountImportControls(view) {
  if (!["people","data"].includes(view) || (view==="people" && getState().focusPersonId)) return;
  const head = document.querySelector("#view .page-head");
  if (!head) return;
  let actions = head.querySelector(".head-actions");
  if (!actions) { actions = document.createElement("div"); actions.className = "head-actions";head.appendChild(actions);}
  if (actions.querySelector('[data-action="importContactsCSV"]')) return;
  const btn = document.createElement("button");btn.type="button";btn.className="btn";
  btn.dataset.action="importContactsCSV";btn.textContent="Import contacts CSV";
  actions.appendChild(btn);
}

export function personaV4OpenUniversalCapture() {
  const people = peopleList();
  const body = `<p class="muted">Describe one interaction in your own words. Persona suggests a person and tags locally, then you review every field. Nothing is saved before you confirm.</p>
    <div class="field"><label for="v4captureText">What happened?</label><textarea id="v4captureText" class="textarea" maxlength="10000" placeholder="I spoke with Alex yesterday about the project…"></textarea></div>
    <button id="v4captureReview" type="button" class="btn btn-primary">Review suggested record</button>
    <div id="v4captureProposal" aria-live="polite" style="margin-top:12px"></div>`;
  const cancel = document.createElement("button"); cancel.className="btn";cancel.textContent="Cancel";
  const save = document.createElement("button"); save.className="btn btn-primary";save.textContent="Save reviewed interaction";save.disabled=true;
  const footer=document.createElement("div");footer.append(cancel,save);
  const modal = openModal({title:"Smart capture",subtitle:"Local suggestions · explicit review",size:"modal-lg",body,footer});
  cancel.onclick=closeModal;
  const input = modal.bodyEl.querySelector("#v4captureText");
  const review = modal.bodyEl.querySelector("#v4captureReview");
  const panel = modal.bodyEl.querySelector("#v4captureProposal");
  let reviewed = "";
  let duplicateApproval = "";
  input.addEventListener("input", () => {reviewed="";save.disabled=true;save.textContent="Save reviewed interaction";panel.textContent="The note changed. Review the updated text before saving.";});
  review.onclick = () => {
    const text=input.value.trim();
    if (!text) {toast("Describe what happened first.","warn");return;}
    const suggestion=parseCapture(text);
    const candidates=personaV4MentionedPeople(text,people);
    const chosen = candidates.length===1 ? candidates[0].id : "";
    const d=new Date();d.setDate(d.getDate()-(Number.isInteger(suggestion.dateOffset)?suggestion.dateOffset:0));
    const day=[d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");
    const labels=candidates.length>1?"Several people were mentioned. Select the right person.":candidates.length===0?"No person confidently matched. Select one below.":"One person matched by name. Please verify.";
    panel.innerHTML=`<div class="card v4-capture-review">
      <h3>Proposed interaction — review before saving</h3><p class="muted">${esc2(labels)} Suggested tags and event types are not facts.</p>
      <div class="form-grid">
        <div class="field"><label for="v4capturePerson">Person *</label><select id="v4capturePerson" class="select" required><option value="">Choose person…</option>${people.map(p=>`<option value="${esc2(p.id)}" ${p.id===chosen?"selected":""}>${esc2(p.name)}</option>`).join("")}</select></div>
        <div class="field"><label for="v4captureDate">Interaction date *</label><input type="date" id="v4captureDate" class="input" value="${esc2(day)}" required></div>
      </div>
      <div class="form-grid"><div class="field"><label for="v4captureType">Event type</label><input class="input" id="v4captureType" value="${esc2(suggestion.type)}" maxlength="120"></div>
        <div class="field"><label for="v4captureInitiator">Who initiated?</label><select class="select" id="v4captureInitiator">${["Unclear","Me","Them","Mutual"].map(v=>`<option ${suggestion.initiator===v?"selected":""}>${v}</option>`).join("")}</select></div></div>
      <div class="field"><label for="v4captureObserved">What I actually observed *</label><textarea id="v4captureObserved" class="textarea" maxlength="10000" required>${esc2(text)}</textarea></div>
      <div class="field"><label for="v4captureInterpretation">My interpretation (optional, not evidence)</label><textarea id="v4captureInterpretation" class="textarea" maxlength="3000" placeholder="Leave empty if you are unsure"></textarea></div>
      <p class="muted">Suggested behaviors: ${suggestion.behaviors.map(esc2).join(", ") || "none"} · Context: ${suggestion.context.map(esc2).join(", ") || "unspecified"}</p>
      <p id="v4captureDuplicateNotice" role="status" class="v4-capture-dup"></p></div>`;
    reviewed=text;duplicateApproval="";save.disabled=!people.length;save.textContent="Save reviewed interaction";
  };
  save.onclick=async()=>{
    if (!reviewed || input.value.trim()!==reviewed) {
      toast("Review the current text before saving.","warn");save.disabled=true;return;
    }
    const personId=panel.querySelector("#v4capturePerson")?.value||"";
    const day=panel.querySelector("#v4captureDate")?.value||"";
    const observed=panel.querySelector("#v4captureObserved")?.value.trim()||"";
    const type=panel.querySelector("#v4captureType")?.value.trim()||"Interaction";
    const interpretation=panel.querySelector("#v4captureInterpretation")?.value.trim()||"";
    if (!personId || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !observed) {
      toast("Person, date and observed facts are required.","warn");return;
    }
    const signature=personId+"|"+day+"|"+personaV4NormalizeContact(observed);
    const duplicates=personaV4InteractionDuplicates(personId,observed,day,getState().data.interactions);
    if (duplicates.length && duplicateApproval!==signature) {
      duplicateApproval=signature;
      save.textContent="Save anyway (possible duplicate)";
      panel.querySelector("#v4captureDuplicateNotice").textContent=
        "Possible duplicate: an interaction with the same person, date and description already exists. Review it before choosing Save anyway.";
      return;
    }
    save.disabled=true;
    try {
      const suggestion=parseCapture(reviewed);
      await create("interactions",{
        personId,date:day+"T12:00",initiator:panel.querySelector("#v4captureInitiator")?.value||"Unclear",
        type,behaviorTags:suggestion.behaviors,context:suggestion.context,
        observed,interpretation,interpretationConfidence:interpretation?"Low":"",
        factOrInterpretation:"Fact",source:"reviewed local smart capture"
      });
      closeModal();toast("Reviewed interaction saved locally.","ok");renderCurrent();
    } catch(e) {save.disabled=false;toast("Could not save the interaction: "+(e?.message||"unknown error"),"bad");}
  };
}
