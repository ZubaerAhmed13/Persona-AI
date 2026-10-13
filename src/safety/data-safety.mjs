// Dependency-free Persona AI data-safety primitives, injected into the single-file build.
// No network access, schema changes, or IndexedDB connection during import evaluation.
export function validatePersonaBackup(parsed, knownStores, existingData = {}, schemaVersion = 7) {
  const errors = [];
  const plain = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
  if (!plain(parsed) || parsed.app !== "PERSONA AI") {
    return { ok: false, errors: ["Not a recognized PERSONA AI backup."] };
  }
  if (!plain(parsed.data)) {
    return { ok: false, errors: ["Backup data must be an object containing record arrays."] };
  }
  if (parsed.settings !== undefined && !plain(parsed.settings)) {
    errors.push("Backup settings must be an object when present.");
  }
  if (parsed.schemaVersion !== undefined && (!Number.isInteger(parsed.schemaVersion) || parsed.schemaVersion < 1 || parsed.schemaVersion > schemaVersion)) {
    errors.push("Backup schema version is invalid or newer than this application supports.");
  }
  // Legacy exports may have appVersion instead of version, or omit format metadata.
  if (parsed.exportFormatVersion !== undefined) {
    const n = Number(parsed.exportFormatVersion);
    if (!Number.isFinite(n) || n <= 0 || n > 3.1) errors.push("Unsupported backup export format.");
  }
  const allowed = new Set(knownStores);
  const incoming = Object.entries(parsed.data);
  if (!incoming.length) errors.push("Backup has no data stores.");
  for (const [name, records] of incoming) {
    if (!allowed.has(name)) {
      errors.push("Unknown data store: " + name);
      continue;
    }
    if (!Array.isArray(records)) {
      errors.push("Store " + name + " must be an array.");
      continue;
    }
    const ids = new Set();
    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      if (!plain(rec)) { errors.push(name + "[" + i + "] is not a record."); continue; }
      const id = rec.id;
      if (!((typeof id === "string" && id.length > 0) || (typeof id === "number" && Number.isFinite(id)))) {
        errors.push(name + "[" + i + "] is missing a valid ID.");
      } else if (ids.has(id)) {
        errors.push("Duplicate ID in " + name + ": " + String(id));
      } else ids.add(id);
      if (rec.schemaVersion !== undefined && (!Number.isInteger(rec.schemaVersion) || rec.schemaVersion > schemaVersion || rec.schemaVersion < 1)) {
        errors.push(name + "[" + i + "] requires an unsupported record schema.");
      }
      for (const key of ["createdAt", "updatedAt"]) {
        if (rec[key] !== undefined && rec[key] !== null && (typeof rec[key] !== "string" || !Number.isFinite(Date.parse(rec[key])))) {
          errors.push(name + "[" + i + "] has an invalid " + key + ".");
        }
      }
      if (name === "people" && (typeof rec.name !== "string" || !rec.name.trim())) {
        errors.push("Person " + String(id) + " requires a name.");
      }
    }
  }
  // Model the effective stores after a partial import. Other stores are preserved.
  // All linked record references must still be valid after the proposed restore.
  if (!errors.length) {
    const effective = {};
    for (const store of knownStores) {
      effective[store] = Object.prototype.hasOwnProperty.call(parsed.data, store)
        ? parsed.data[store]
        : (Array.isArray(existingData?.[store]) ? existingData[store] : []);
    }
    const links = { personId: "people", playbookId: "playbooks", signalId: "signals", decisionId: "decisions" };
    const keys = Object.fromEntries(Object.values(links).map((name) => [name, new Set(effective[name].map((r) => r?.id))]));
    for (const [store, records] of Object.entries(effective)) {
      for (const rec of records) {
        if (!plain(rec)) continue;
        for (const [field, target] of Object.entries(links)) {
          if (store === "people" && field === "personId") continue;
          if (rec[field] != null && rec[field] !== "" && !keys[target].has(rec[field])) {
            errors.push(store + " record " + String(rec.id) + " has unresolved " + field + ".");
            if (errors.length >= 30) break;
          }
        }
        if (errors.length >= 30) break;
      }
      if (errors.length >= 30) break;
    }
  }
  return { ok: errors.length === 0, errors };
}

// One readwrite transaction covers ALL changed stores. Either every clear/put
// commits, or the browser rolls the complete transaction back on request error,
// explicit abort, tab termination, or shutdown. Never await within the tx.
export function personaAtomicRestore(dbConnection, data) {
  const names = Object.keys(data);
  return new Promise((resolve, reject) => {
    if (!names.length) { reject(new Error("There are no stores to restore.")); return; }
    let tx;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error || new Error("The restore transaction was aborted."));
    };
    try {
      tx = dbConnection.transaction(names, "readwrite");
      tx.oncomplete = () => { if (!settled) { settled = true; resolve(); } };
      tx.onabort = () => fail(tx.error || new Error("The restore transaction was aborted. No records were replaced."));
      for (const name of names) {
        const store = tx.objectStore(name);
        store.clear();
        for (const record of data[name]) store.put(record);
      }
    } catch (error) {
      try { tx?.abort(); } catch {}
      fail(error);
    }
  });
}

// Database-level cascade (including the real primary people.id record).
// Reads the personId index inside a single transaction, preventing partial
// deletion, and removes linked audit records as well as ordinary activity.
export function personaAtomicDeletePerson(dbConnection, stores, personId, keyRangeFactory = IDBKeyRange) {
  return new Promise((resolve, reject) => {
    if (!personId) { reject(new Error("A person ID is required.")); return; }
    let tx;
    let settled = false;
    const fail = (error) => {
      if (!settled) { settled = true; reject(error || new Error("Person deletion was aborted.")); }
    };
    try {
      tx = dbConnection.transaction(stores, "readwrite");
      tx.oncomplete = () => { if (!settled) { settled = true; resolve(); } };
      tx.onabort = () => fail(tx.error || new Error("Person deletion was aborted. No records were deleted."));
      tx.objectStore("people").delete(personId);
      for (const name of stores) {
        if (name === "people") continue;
        const store = tx.objectStore(name);
        const request = store.index("personId").openKeyCursor(keyRangeFactory.only(personId));
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          store.delete(cursor.primaryKey);
          cursor.continue();
        };
      }
    } catch (error) {
      try { tx?.abort(); } catch {}
      fail(error);
    }
  });
}
