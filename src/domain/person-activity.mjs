// Persona AI v4 Stage 4. Pure read-only selectors; no storage access, network, or mutable state.
export function personaV4ActivityList(data, personId = null) {
  const arrays = data && typeof data === "object" ? data : {};
  const specs = [
    ["interactions", "interaction", ["observed", "whatHappened", "type"], ["date", "createdAt"]],
    ["observations", "observation", ["content", "observed"], ["date", "createdAt"]],
    ["memories", "memory", ["info", "text"], ["date", "createdAt"]],
    ["commitments", "commitment", ["commitment", "description"], ["createdAt", "date"]],
    ["decisions", "decision", ["question", "description"], ["date", "createdAt"]],
    ["followUps", "followUp", ["text", "title", "description"], ["createdAt", "date"]]
  ];
  const pick = (record, fields) => {
    for (const key of fields) {
      if (typeof record[key] === "string" && record[key].trim()) return record[key].trim();
    }
    return "";
  };
  const out = [];
  for (const [store, kind, titleFields, dateFields] of specs) {
    for (const record of Array.isArray(arrays[store]) ? arrays[store] : []) {
      if (!record || typeof record !== "object" || typeof record.id !== "string") continue;
      if (personId && record.personId !== personId) continue;
      const rawDate = pick(record, dateFields);
      const date = /^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$/.test(rawDate) ? rawDate : "";
      const dueRaw = kind === "followUp" ? record.dueDate : kind === "commitment" ? record.expectedCompletion || record.dueDate : "";
      const due = typeof dueRaw === "string" && /^\d{4}-\d{2}-\d{2}/.test(dueRaw) ? dueRaw.slice(0, 10) : "";
      const interpretation = kind === "interaction" || kind === "observation" ? pick(record, ["interpretation"]) : "";
      out.push({
        id: record.id, personId: typeof record.personId === "string" ? record.personId : "",
        kind, title: pick(record, titleFields) || "Untitled " + kind,
        date, due, interpretation, sourceStore: store
      });
    }
  }
  return out.sort((a, b) => {
    if (!a.date && b.date) return 1;
    if (a.date && !b.date) return -1;
    return b.date.localeCompare(a.date) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id);
  });
}

export function personaV4PersonSummary(data, personId) {
  const arrays = data && typeof data === "object" ? data : {};
  const related = (store) => (Array.isArray(arrays[store]) ? arrays[store] : []).filter((x) => x && x.personId === personId);
  const isClosed = (r) => r.completed === true || r.cancelled === true ||
    ["done", "completed", "cancelled", "archived"].includes(String(r.status || "").toLowerCase());
  const interactions = personaV4ActivityList({ interactions: related("interactions") }, personId);
  const openFollowUps = related("followUps").filter((r) => !isClosed(r));
  const openCommitments = related("commitments").filter((r) => !isClosed(r));
  const datedFollowUps = openFollowUps.map((r) => String(r.dueDate || "").slice(0, 10))
    .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s)).sort();
  return {
    lastInteraction: interactions[0]?.date.slice(0, 10) || "",
    interactions: interactions.length,
    memories: related("memories").length,
    openFollowUps: openFollowUps.length,
    openCommitments: openCommitments.length,
    nextFollowUp: datedFollowUps[0] || ""
  };
}

export function personaV4FilterActivity(rows, filters = {}) {
  const query = String(filters.search || "").trim().toLocaleLowerCase();
  const kind = String(filters.kind || "");
  const personId = String(filters.personId || "");
  return (Array.isArray(rows) ? rows : []).filter((row) =>
    (!kind || row.kind === kind) &&
    (!personId || row.personId === personId) &&
    (!query || [row.title, row.interpretation, row.kind, row.date, row.due].some((value) =>
      String(value || "").toLocaleLowerCase().includes(query)))
  );
}
