// Pure, local-first Today selectors. Neither read nor write IndexedDB,
// mutable state, browser storage, global clocks or remote services.
// All dates are local calendar keys (YYYY-MM-DD), never UTC clock cutoffs.
export function personaCalendarDay(value) {
  const text = String(value ?? "");
  const day = text.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "";
  const parsed = new Date(day + "T12:00:00.000Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : "";
}
export function personaAddCalendarDays(day, offset) {
  const valid = personaCalendarDay(day);
  if (!valid || !Number.isInteger(offset)) return "";
  const date = new Date(valid + "T12:00:00.000Z");
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
export function personaRecordClosed(item) {
  if (!item || typeof item !== "object" || item.completed === true || item.cancelled === true) return true;
  return ["done", "completed", "cancelled", "archived"].includes(String(item.status || "").toLowerCase());
}
export function personaFollowUpOpen(item, today) {
  if (personaRecordClosed(item)) return false;
  if (String(item.status || "").toLowerCase() !== "snoozed") return true;
  return personaFollowUpDue(item, today);
}
export function personaFollowUpDue(item, today) {
  if (personaRecordClosed(item)) return false;
  const day = personaCalendarDay(item.dueDate);
  return !day || day <= today;
}
export function personaSelectTodayItems(data, today, nowIso) {
  if (!personaCalendarDay(today)) return [];
  const rows = [];
  const all = (name) => Array.isArray(data?.[name]) ? data[name] : [];
  const fallback = typeof nowIso === "string" && nowIso ? nowIso : today + "T12:00:00";
  for (const c of all("commitments")) {
    if (personaRecordClosed(c)) continue;
    const due = personaCalendarDay(c.expectedCompletion || c.dueDate);
    if (!due || due > today) continue;
    rows.push({ kind: "commitment", personId: c.personId, text: c.commitment || c.description || "Commitment", due, overdue: due < today, id: c.id });
  }
  for (const p of all("predictions")) {
    if (p.outcome && p.outcome !== "pending") continue;
    rows.push({ kind: "prediction", personId: p.personId, text: p.predictionText || p.prediction || p.target || "Prediction", due: p.date || fallback, id: p.id });
  }
  for (const f of all("followUps")) {
    if (!personaFollowUpDue(f, today)) continue;
    const due = personaCalendarDay(f.dueDate);
    rows.push({ kind: "followUp", personId: f.personId, text: f.text || f.title || f.description || "Follow-up", due: due || fallback, id: f.id });
  }
  for (const m of all("memories")) {
    if (personaRecordClosed(m)) continue;
    const due = personaCalendarDay(m.reminderDate);
    if (!due || due > today) continue;
    rows.push({ kind: "memory", personId: m.personId, text: m.info || m.text || "Memory", due, id: m.id });
  }
  return rows.sort((a, b) => String(a.due).localeCompare(String(b.due)) ||
    String(a.kind).localeCompare(String(b.kind)) || String(a.id).localeCompare(String(b.id)));
}
export function personaSelectWeekAhead(data, today, days = 7) {
  if (!personaCalendarDay(today) || !Number.isInteger(days) || days < 1 || days > 31) return [];
  const limit = personaAddCalendarDays(today, days);
  const all = (name) => Array.isArray(data?.[name]) ? data[name] : [];
  const rows = [];
  const add = (kind, item, due, text) => {
    if (due && due > today && due <= limit)
      rows.push({ kind, personId: item.personId, id: item.id, text, due });
  };
  for (const c of all("commitments")) {
    if (!personaRecordClosed(c))
      add("commitment", c, personaCalendarDay(c.expectedCompletion || c.dueDate), c.commitment || c.description || "Commitment");
  }
  for (const f of all("followUps")) {
    if (!personaRecordClosed(f))
      add("followUp", f, personaCalendarDay(f.dueDate), f.text || f.title || f.description || "Follow-up");
  }
  for (const m of all("memories")) {
    if (!personaRecordClosed(m))
      add("memory", m, personaCalendarDay(m.reminderDate), m.info || m.text || "Memory");
  }
  return rows.sort((a, b) => a.due.localeCompare(b.due) || a.kind.localeCompare(b.kind) ||
    String(a.id).localeCompare(String(b.id)));
}
