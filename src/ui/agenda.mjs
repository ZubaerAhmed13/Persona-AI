// Stage 3: actionable seven-day outlook built from read-only domain selectors.
// No writes, no external provider or background task.
export function personaRenderWeekAheadAgenda(data, today) {
  const upcoming = personaSelectWeekAhead(data, today, 7);
  const actions = {
    commitment: ["completeCommitment", "Complete", "Commitment", "commitments"],
    followUp: ["completeFollowUp", "Done", "Follow-up", "followups"],
    memory: ["completeMemory", "Check in", "Memory", "memory"]
  };
  const rows = upcoming.slice(0, 5).map((item) => {
    const [action, actionLabel, type, destination] = actions[item.kind];
    const who = item.personId ? personName(item.personId) : "General";
    return '<div class="persona-agenda-row">' +
      '<span class="persona-agenda-date">' + esc2(item.due) + '</span>' +
      '<div class="persona-agenda-details"><strong>' + esc2(item.text) + '</strong>' +
      '<span>' + esc2(type) + ' · ' + esc2(who) + '</span></div>' +
      '<div class="persona-agenda-actions">' +
      '<button class="btn btn-sm btn-primary" data-action="' + action + '" data-arg="' + esc2(item.id) + '">' + actionLabel + '</button>' +
      '<button class="btn btn-sm" data-goto="' + destination + '" aria-label="Open ' + type + ' workspace">View</button></div></div>';
  }).join("");
  return '<section class="card persona-agenda" aria-label="Seven-day agenda">' +
    '<div class="card-title">Coming up <span class="ctl muted">' + upcoming.length + ' planned · next 7 days</span></div>' +
    '<p class="persona-agenda-desc">A preview of scheduled commitments, follow-ups and memory reminders. Everything stays on this device.</p>' +
    (rows ? '<div class="persona-agenda-list">' + rows + '</div>' +
      (upcoming.length > 5 ? '<p class="persona-agenda-desc">Showing the first 5 of ' + upcoming.length + ' items. Open the related workspaces to see the rest.</p>' : '') :
      '<div class="persona-agenda-empty">Nothing scheduled for the next seven days. <button class="link-btn" data-action="addFollowUp">Add a follow-up</button></div>') +
    '</section>';
}
