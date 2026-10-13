// Stage 5: pure local selectors for consent-first capture, CSV review, and relevance-search.
export function personaV4NormalizeContact(value) {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function personaV4PersonMatches(name, people, omitId = null) {
  const key = personaV4NormalizeContact(name);
  if (!key) return [];
  return (Array.isArray(people) ? people : []).filter((p) =>
    p && p.id !== omitId && [p.name, p.alias].some((v) => personaV4NormalizeContact(v) === key));
}

export function personaV4MentionedPeople(text, people) {
  const source = personaV4NormalizeContact(text);
  if (!source) return [];
  const padded = " " + source + " ";
  const hits = [];
  for (const p of Array.isArray(people) ? people : []) {
    if (!p || typeof p.id !== "string") continue;
    for (const raw of [p.name, p.alias]) {
      const name = personaV4NormalizeContact(raw);
      if (!name || name.length < 2) continue;
      // Match whole human-readable tokens; do not mistake "Ann" for "Anna".
      const start = padded.indexOf(name);
      if (start < 0) continue;
      const left = padded[start - 1] || "";
      const right = padded[start + name.length] || "";
      if (/[\p{L}\p{N}]/u.test(left) || /[\p{L}\p{N}]/u.test(right)) continue;
      hits.push({ id: p.id, name: p.name, matchLength: name.length });
      break;
    }
  }
  return hits.sort((a, b) => b.matchLength - a.matchLength || String(a.name).localeCompare(String(b.name)));
}

export function personaV4InteractionDuplicates(peopleId, text, date, interactions) {
  const personId = String(peopleId || "");
  const norm = personaV4NormalizeContact(text).replace(/[.,!?]+$/g,"");
  const day = String(date || "").slice(0, 10);
  if (!personId || norm.length < 4 || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return [];
  return (Array.isArray(interactions) ? interactions : []).filter((r) =>
    r && r.personId === personId && String(r.date || "").slice(0,10) === day &&
    personaV4NormalizeContact(r.observed || r.whatHappened).replace(/[.,!?]+$/g,"") === norm);
}

export function personaV4ParseContactCSV(text) {
  const source = String(text || "");
  if (source.length > 1048576) throw new Error("CSV file is larger than 1 MB.");
  const rows = [];
  let row = [], cell = "", quoted = false, closedQuote = false;
  const addCell = () => {
    if (cell.length > 2000) throw new Error("A CSV field exceeds 2,000 characters.");
    row.push(cell);
    cell = "";
    closedQuote = false;
  };
  const addRow = () => {
    addCell();
    if (row.some((v) => v.trim())) rows.push(row);
    row = [];
    if (rows.length > 501) throw new Error("Import at most 500 contacts at a time.");
  };
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"' && source[i+1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quoted = false; closedQuote = true; }
      else cell += c;
    } else if (c === '"') {
      if (cell || closedQuote) throw new Error("Invalid CSV quotation.");
      quoted = true;
    } else if (c === ",") addCell();
    else if (c === "\r" || c === "\n") {
      if (c === "\r" && source[i+1] === "\n") i++;
      addRow();
    } else {
      if (closedQuote && c !== " " && c !== "\t") throw new Error("Unexpected characters after closing CSV quote.");
      cell += c;
    }
  }
  if (quoted) throw new Error("Unclosed quoted CSV field.");
  if (cell || row.length) addRow();
  if (!rows.length) throw new Error("CSV is empty.");
  const headers = rows.shift().map((x) => personaV4NormalizeContact(x.replace(/^\uFEFF/,"")).replace(/[\s_-]+/g,""));
  const find = (...names) => headers.findIndex((v) => names.includes(v));
  const nameIndex = find("name","fullname","contactname");
  if (nameIndex < 0) throw new Error("CSV must contain a Name or Full Name column.");
  const idx = {
    name: nameIndex, alias: find("alias","nickname"), organization: find("organization","company"),
    relationshipType: find("relationship","relationshiptype"), notes: find("notes","note"),
    communicationPreferences: find("communicationpreferences"), importantDates: find("importantdates")
  };
  return rows.map((r, rowIndex) => {
    const field = (key) => idx[key] < 0 ? "" : String(r[idx[key]] || "").trim();
    const person = Object.fromEntries(Object.keys(idx).map((k) => [k, field(k)]));
    const issues = [];
    if (!person.name) issues.push("Name is missing");
    if (person.name.length > 120) issues.push("Name exceeds 120 characters");
    if (r.length > headers.length && r.slice(headers.length).some(x => x.trim())) issues.push("Too many CSV columns");
    return { rowNumber: rowIndex + 2, person, issues };
  });
}

export function personaV4ContactCSVPreview(rows, existingPeople) {
  const seen = new Map();
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const key = personaV4NormalizeContact(r.person.name);
    const duplicateExisting = personaV4PersonMatches(r.person.name, existingPeople).map((p) => p.name);
    const prior = key && seen.has(key) ? seen.get(key) : null;
    if (key && !seen.has(key)) seen.set(key, r.rowNumber);
    return { ...r, duplicateExisting, duplicateRow: prior, canImport: !r.issues.length && !duplicateExisting.length && !prior };
  });
}

export function personaV4SearchRecords(query, data, filters = {}) {
  const q = personaV4NormalizeContact(query);
  const all = data && typeof data === "object" ? data : {};
  if (!q && !filters.personId && !filters.days) return [];
  const people = Array.isArray(all.people) ? all.people : [];
  const names = new Map(people.map(p => [p.id, String(p.name || "")]));
  const columns = {
    people: ["name","alias","organization","relationshipType","context","notes","communicationPreferences"],
    interactions: ["observed","whatHappened","interpretation","type","location"],
    observations: ["content","interpretation","context"],
    memories: ["info","text","category"],
    commitments: ["commitment","description"], decisions: ["question","situation"],
    followUps: ["text","title","description"], predictions: ["predictionText","target"]
  };
  const labels = {people:"Person",interactions:"Interaction",observations:"Observation",memories:"Memory",
    commitments:"Commitment",decisions:"Decision",followUps:"Follow-up",predictions:"Prediction"};
  const results = [];
  for (const [store, fields] of Object.entries(columns)) {
    for (const r of Array.isArray(all[store]) ? all[store] : []) {
      if (!r || typeof r.id !== "string") continue;
      if (filters.personId && store !== "people" && r.personId !== filters.personId) continue;
      if (filters.personId && store === "people" && r.id !== filters.personId) continue;
      const name = store === "people" ? String(r.name || "") : names.get(r.personId) || "";
      const haystack = fields.map(k => typeof r[k] === "string" ? r[k] : "").concat(name).join(" ");
      const norm = personaV4NormalizeContact(haystack);
      if (q && !norm.includes(q) && !q.split(" ").filter(Boolean).every(word => norm.includes(word))) continue;
      const date = String(r.date || r.createdAt || "").slice(0,10);
      if (filters.days && store !== "people") {
        const cutoff = filters.cutoff || "";
        if (!date || (cutoff && date < cutoff)) continue;
      }
      const priority = personaV4NormalizeContact(name) === q ? 4 :
        personaV4NormalizeContact(name).startsWith(q) ? 3 :
        norm.startsWith(q) ? 2 : 1;
      const title = store === "people" ? name : String(fields.map(k => r[k]).find(v => typeof v === "string" && v.trim()) || labels[store]).slice(0,90);
      results.push({store,id:r.id,kind:labels[store],title,sub:store === "people" ? String(r.relationshipType || "") : name,priority,date});
    }
  }
  return results.sort((a,b) => b.priority-a.priority || b.date.localeCompare(a.date) || a.title.localeCompare(b.title)).slice(0,16);
}
