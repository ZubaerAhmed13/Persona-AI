// Persona AI 4.0: progressive enhancement of the original one-file app.
// No cloud resources, dependency, schema change, or write to user data.
export function personaV4InitWorkspace() {
  const nav = document.getElementById("primaryNav");
  if (!nav || document.getElementById("v4PrimaryNav")) return;
  const core = [
    ["dashboard", "Today", "dashboard"],
    ["people", "People", "people"],
    ["interactions", "Activity", "interactions"],
    ["followups", "Follow-ups", "reliability"],
    ["patterns", "Insights", "patterns"],
    ["copilot", "Copilot", "spark"]
  ];
  const coreNav = document.createElement("nav");
  coreNav.id = "v4PrimaryNav";
  coreNav.setAttribute("aria-label", "Main workspace");
  const heading = document.createElement("div");
  heading.className = "v4-nav-eyebrow";
  heading.textContent = "Workspace";
  coreNav.appendChild(heading);
  for (const [view, label, ico] of core) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "v4-core-link";
    button.dataset.v4View = view;
    button.setAttribute("aria-label", label);
    const image = document.createElement("span");
    image.className = "v4-core-ico";
    image.setAttribute("aria-hidden", "true");
    image.innerHTML = icon(ico, 19);
    const textNode = document.createElement("span");
    textNode.className = "v4-core-label";
    textNode.textContent = label;
    button.append(image, textNode);
    if (view === "followups") {
      const count = document.createElement("span");
      count.className = "v4-count";
      count.hidden = true;
      count.id = "v4DueCount";
      button.appendChild(count);
    }
    button.addEventListener("click", () => {
      getState().focusPersonId = null;
      navigate2(view);
      document.getElementById("sidebar")?.classList.remove("open");
    });
    coreNav.appendChild(button);
  }
  nav.before(coreNav);
  const tools = document.createElement("div");
  tools.className = "v4-sidebar-tools";
  const advanced = document.createElement("button");
  advanced.type = "button";
  advanced.id = "v4AdvancedToggle";
  advanced.className = "v4-advanced-toggle";
  advanced.setAttribute("aria-controls", "primaryNav");
  advanced.innerHTML = '<span>All tools · 34 legacy views</span><span class="v4-chevron" aria-hidden="true">⌄</span>';
  tools.appendChild(advanced);
  nav.before(tools);
  let expanded = false;
  try { expanded = localStorage.getItem("persona.ui.v4.allToolsExpanded") === "1"; } catch {}
  const setExpanded = (value) => {
    expanded = !!value;
    nav.hidden = !expanded;
    advanced.setAttribute("aria-expanded", String(expanded));
    try { localStorage.setItem("persona.ui.v4.allToolsExpanded", expanded ? "1" : "0"); } catch {}
  };
  advanced.addEventListener("click", () => setExpanded(!expanded));
  setExpanded(expanded);

  // Original sidebar nav remains functional and is shown on demand. Its
  // 34 historic data-view/aria-label contracts remain completely untouched.
  subscribe("data", () => personaV4SyncWorkspace(getState().view));
  personaV4SyncWorkspace(getState().view);
}

export function personaV4SyncWorkspace(view) {
  const labels = {
    dashboard: "Today", people: "People", interactions: "Activity",
    followups: "Follow-ups", patterns: "Insights", copilot: "Copilot"
  };
  const active = labels[view] || null;
  document.querySelectorAll("#v4PrimaryNav [data-v4-view]").forEach((button) => {
    const selected = button.dataset.v4View === view;
    button.classList.toggle("active", selected);
    if (selected) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  const count = document.getElementById("v4DueCount");
  if (count) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = (getState().data.followUps || []).filter((item) => {
      if (item.completed || ["done", "completed", "cancelled"].includes(String(item.status || "").toLowerCase())) return false;
      if (!item.dueDate) return false;
      const date = new Date(item.dueDate);
      return !isNaN(date) && date < new Date(today.getTime() + 864e5);
    }).length;
    count.textContent = String(due);
    count.hidden = due === 0;
    count.setAttribute("aria-label", due + " follow-ups due");
  }
  const toggle = document.getElementById("v4AdvancedToggle");
  if (toggle) toggle.classList.toggle("active", !active);
}

export function renderPersonaV4FollowUps() {
  const s = getState();
  const pid = s.contextPersonId === "all" ? null : s.contextPersonId;
  const items = (s.data.followUps || [])
    .filter((item) => !pid || item.personId === pid);
  const done = (item) => item.completed === true || ["done", "completed", "cancelled"].includes(String(item.status || "").toLowerCase());
  const today = todayLocal();
  const key = (item) => item.dueDate ? String(item.dueDate).slice(0, 10) : "";
  const pending = items.filter((item) => !done(item)).sort((a, b) => {
    const ak = key(a) || "9999-12-31";
    const bk = key(b) || "9999-12-31";
    return ak.localeCompare(bk) || String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
  });
  const overdue = pending.filter((item) => key(item) && key(item) < today).length;
  const dueToday = pending.filter((item) => key(item) === today).length;
  const finished = items.length - pending.length;
  const rows = pending.map((item) => {
    const d = key(item);
    const old = d && d < today;
    const label = item.text || item.title || item.description || "Follow-up";
    const who = item.personId ? personName(item.personId) : "General";
    return '<div class="v4-followup-row">' +
      '<div class="v4-followup-title"><strong>' + esc2(label) + '</strong>' +
      '<div class="v4-followup-meta">' + esc2(who) +
      (d ? ' · <span class="' + (old ? "v4-overdue" : "") + '">' + (old ? "Overdue · " : "Due ") + esc2(d) + '</span>' : ' · No due date') +
      '</div></div>' +
      '<div class="v4-followup-actions">' +
      '<button class="btn btn-sm btn-primary" data-action="completeFollowUp" data-arg="' + esc2(item.id) + '">Complete</button>' +
      '<button class="btn btn-sm" data-action="snoozeFollowUp" data-arg="' + esc2(item.id) + '">+3 days</button>' +
      (item.personId ? '<button class="btn btn-sm" data-action="viewPerson" data-arg="' + esc2(item.personId) + '">Person</button>' : '') +
      '</div></div>';
  }).join("");
  return '<div class="page-head">' +
    '<div><div class="page-title">Follow-ups</div>' +
    '<div class="page-desc">One place for the next conversations and reminders in your records. Prioritized by due date, with no external sync.</div></div>' +
    '<div class="head-actions"><button class="btn btn-primary" data-action="addFollowUp">+ New follow-up</button></div></div>' +
    '<div class="v4-followup-grid" role="group" aria-label="Follow-up overview">' +
    '<div class="v4-followup-card"><strong>' + pending.length + '</strong><span>Open</span></div>' +
    '<div class="v4-followup-card"><strong>' + (overdue + dueToday) + '</strong><span>Due now</span></div>' +
    '<div class="v4-followup-card"><strong>' + finished + '</strong><span>Completed</span></div></div>' +
    (rows ? '<div class="v4-followup-list">' + rows + '</div>' :
      '<div class="card empty"><h3>All caught up</h3><p>No pending follow-ups in this context.</p><button class="btn btn-primary" data-action="addFollowUp">Add a follow-up</button></div>') +
    '<div class="v4-simple-hero" style="margin-top:18px"><p class="muted">Need a wider view of commitments, predictions, and unresolved decisions? Open <button class="link-btn" data-goto="openloops">Open Loops</button>.</p></div>';
}
