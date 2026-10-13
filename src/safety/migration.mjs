// Persona local-first, idempotent legacy schema repair.
// Each IndexedDB transaction is scoped to a single store and is entirely
// cursor-driven, never retained across an awaited getAll(). An interruption
// leaves previous stores committed and unfinished stores eligible for retry.
export async function repairPersonaLegacySchemas(connection, stores, schemaVersion, report = {}) {
  if (!connection || !Array.isArray(stores) || !Number.isInteger(schemaVersion)) {
    throw new TypeError("Invalid legacy schema repair arguments.");
  }
  const summary = { checked: 0, backfilled: 0, storesCommitted: 0 };
  for (const name of stores) {
    const changes = await new Promise((resolve, reject) => {
      let tx;
      let checked = 0;
      let fixed = 0;
      let settled = false;
      function fail(error) {
        if (settled) return;
        settled = true;
        reject(error || new Error("Legacy schema repair was aborted for " + name));
      }
      try {
        tx = connection.transaction(name, "readwrite");
        tx.oncomplete = () => {
          if (settled) return;
          settled = true;
          resolve({ checked, fixed });
        };
        tx.onabort = () => fail(tx.error || new Error("Legacy schema repair aborted in " + name));
        const store = tx.objectStore(name);
        const req = store.openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return;
          const record = cursor.value;
          checked++;
          if (record && typeof record === "object" && !record.schemaVersion) {
            cursor.update({
              ...record,
              schemaVersion,
              updatedAt: record.updatedAt || record.createdAt || new Date().toISOString()
            });
            fixed++;
          }
          cursor.continue();
        };
      } catch (error) {
        try { tx?.abort(); } catch {}
        fail(error);
      }
    });
    // Reflect only committed store transactions, never speculative cursor edits.
    summary.checked += changes.checked;
    summary.backfilled += changes.fixed;
    summary.storesCommitted++;
    report.recordsChecked = (report.recordsChecked || 0) + changes.checked;
    report.schemaBackfilled = (report.schemaBackfilled || 0) + changes.fixed;
  }
  return summary;
}
