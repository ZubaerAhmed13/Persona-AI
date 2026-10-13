import { personaV4ActivityList, personaV4PersonSummary, personaV4FilterActivity } from "../domain/person-activity.mjs";

export function personaV4EscapeActivity(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function personaV4RenderActivityRows(rows, data) {
  const people = new Map((Array.isArray(data?.people) ? data.people : []).map((p) => [p.id, p.name]));
  const labels = { interaction: "Interaction", observation: "Observation", memory: "Memory", commitment: "Commitment", decision: "Decision", followUp: "Follow-up" };
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const name = people.get(row.personId) || (row.personId ? "Unknown person" : "General");
    const date = row.date ? row.date.slice(0, 10) : "Date not recorded";
    const preview = row.title.length > 500 ? row.title.slice(0, 500) + "…" : row.title;
    return `<article class="v4-activity-entry">
      <div class="v4-activity-entry-top"><span class="v4-activity-kind">${personaV4EscapeActivity(labels[row.kind] || row.kind)}</span>
        <time>${personaV4EscapeActivity(date)}</time></div>
      <div class="v4-activity-entry-title">${personaV4EscapeActivity(preview)}</div>
      ${row.interpretation ? `<div class="v4-activity-interpretation"><span>Interpretation (not a fact):</span> ${personaV4EscapeActivity(row.interpretation.slice(0, 300))}</div>` : ""}
      ${row.due ? `<div class="v4-activity-due">Due: ${personaV4EscapeActivity(row.due)}</div>` : ""}
      <div class="v4-activity-entry-foot"><span>${personaV4EscapeActivity(name)}</span>
      ${row.personId && people.has(row.personId) ? `<button class="link-btn" type="button" data-action="viewPerson" data-arg="${personaV4EscapeActivity(row.personId)}">View person</button>` : ""}</div>
    </article>`;
  }).join("");
}

export function personaV4RenderActivityShell(data, profileId = "") {
  const isProfile = Boolean(profileId);
  const prefix = isProfile ? "v4Person" : "v4Activity";
  const people = (Array.isArray(data?.people) ? data.people : []).slice().sort((a,b) => String(a.name || "").localeCompare(String(b.name || "")));
  return `<section class="v4-activity-panel card" id="${prefix}Timeline" aria-labelledby="${prefix}TimelineTitle" data-person-id="${personaV4EscapeActivity(profileId)}">
    <div class="v4-activity-header"><div>
      <h2 class="v4-activity-heading" id="${prefix}TimelineTitle">${isProfile ? "Recent activity with this person" : "Unified activity timeline"}</h2>
      <p class="v4-activity-help">A chronological view of recorded interactions, observations, memories, decisions, commitments and follow-ups. No AI interpretation is added.</p>
    </div></div>
    <div class="v4-activity-controls">
      ${isProfile ? "" : `<label class="v4-activity-control" for="${prefix}Person">Person<select id="${prefix}Person" class="select" data-v4-person><option value="">All people</option>${people.map((p) => `<option value="${personaV4EscapeActivity(p.id)}">${personaV4EscapeActivity(p.name)}</option>`).join("")}</select></label>`}
      <label class="v4-activity-control" for="${prefix}Kind">Record type<select id="${prefix}Kind" class="select" data-v4-kind>
        <option value="">All records</option><option value="interaction">Interactions</option><option value="observation">Observations</option>
        <option value="memory">Memories</option><option value="commitment">Commitments</option><option value="decision">Decisions</option><option value="followUp">Follow-ups</option>
      </select></label>
      <label class="v4-activity-control v4-activity-search" for="${prefix}Search">Search timeline<input id="${prefix}Search" class="input" type="search" maxlength="140" data-v4-search placeholder="Find a recorded detail"></label>
    </div>
    <div class="v4-activity-count" data-v4-count aria-live="polite"></div>
    <div class="v4-activity-list" data-v4-results></div>
    <button type="button" class="btn btn-sm v4-activity-more" data-v4-more hidden>Show more records</button>
  </section>`;
}

export function personaV4MountPeopleActivity(view) {
  const root = document.getElementById("view");
  if (!root) return;
  const state = getState();
  if (view === "people" && state.focusPersonId) {
    const person = (state.data.people || []).find((p) => p.id === state.focusPersonId);
    const strip = root.querySelector(".kpi-strip");
    if (!person || !strip) return;
    const summary = personaV4PersonSummary(state.data, person.id);
    const section = document.createElement("section");
    section.className = "v4-person-snapshot card";
    section.setAttribute("aria-label", "Person at a glance");
    section.innerHTML = `<div class="v4-person-snapshot-head"><h2>At a glance</h2><span>Based only on saved records</span></div>
      <div class="v4-person-metrics">
      <div><strong>${personaV4EscapeActivity(summary.lastInteraction || "—")}</strong><span>Last recorded interaction</span></div>
      <div><strong>${summary.openFollowUps}</strong><span>Open follow-ups</span></div>
      <div><strong>${summary.openCommitments}</strong><span>Open commitments</span></div>
      <div><strong>${summary.memories}</strong><span>Saved memories</span></div></div>
      <div class="v4-person-snapshot-foot">
        <span>${summary.nextFollowUp ? "Next follow-up due " + personaV4EscapeActivity(summary.nextFollowUp) : "No dated follow-up currently recorded"}</span>
        <button class="btn btn-sm" type="button" data-action="addFollowUp" data-arg="${personaV4EscapeActivity(person.id)}">+ Follow-up</button>
        <button class="btn btn-sm" type="button" data-action="editPerson" data-arg="${personaV4EscapeActivity(person.id)}">Edit profile</button>
      </div>`;
    strip.before(section);
    const timeline = document.createElement("div");
    timeline.innerHTML = personaV4RenderActivityShell(state.data, person.id);
    strip.before(timeline.firstElementChild);
  } else if (view === "interactions") {
    const head = root.querySelector(".page-head");
    if (!head) return;
    const title = head.querySelector(".page-title");
    if (title) title.textContent = "Activity";
    const wrapper = document.createElement("div");
    wrapper.innerHTML = personaV4RenderActivityShell(state.data);
    head.after(wrapper.firstElementChild);
    const list = root.querySelector('[data-list-type="interactions"]');
    if (list) list.setAttribute("aria-label", "Detailed interaction records");
  }
}

export function personaV4BindPeopleActivity() {
  const root = document.getElementById("view");
  if (!root) return;
  root.querySelectorAll(".v4-activity-panel").forEach((panel) => {
    const state = getState();
    const fixedPerson = panel.getAttribute("data-person-id") || "";
    const personSelect = panel.querySelector("[data-v4-person]");
    const kindSelect = panel.querySelector("[data-v4-kind]");
    const searchInput = panel.querySelector("[data-v4-search]");
    const count = panel.querySelector("[data-v4-count]");
    const results = panel.querySelector("[data-v4-results]");
    const more = panel.querySelector("[data-v4-more]");
    const initialContext = state.contextPersonId && state.contextPersonId !== "all" ? state.contextPersonId : "";
    if (personSelect && [...personSelect.options].some((o) => o.value === initialContext)) personSelect.value = initialContext;
    let limit = fixedPerson ? 12 : 24;
    const update = () => {
      const latest = getState().data;
      const allRows = personaV4ActivityList(latest, fixedPerson || null);
      const filtered = personaV4FilterActivity(allRows, {
        personId: fixedPerson || personSelect?.value || "",
        kind: kindSelect?.value || "",
        search: searchInput?.value || ""
      });
      const displayed = filtered.slice(0, limit);
      results.innerHTML = displayed.length ? personaV4RenderActivityRows(displayed, latest) :
        '<p class="v4-activity-empty">No matching records. Try another filter or add an interaction.</p>';
      count.textContent = `${displayed.length} of ${filtered.length} recorded items`;
      more.hidden = filtered.length <= limit;
    };
    [personSelect, kindSelect].filter(Boolean).forEach((el) => el.addEventListener("change", () => { limit = fixedPerson ? 12 : 24; update(); }));
    searchInput?.addEventListener("input", () => { limit = fixedPerson ? 12 : 24; update(); });
    more.addEventListener("click", () => { limit += 24; update(); });
    update();
  });
}
