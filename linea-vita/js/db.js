(function () {
  "use strict";

  const DB_NAME = "edilkappa-linea-vita";
  const DB_VERSION = 1;
  const INSPECTIONS = "inspections";
  const SETTINGS = "settings";

  let dbPromise;

  function openDb() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("Il browser non supporta l'archivio locale IndexedDB."));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(INSPECTIONS)) {
          const store = db.createObjectStore(INSPECTIONS, { keyPath: "id" });
          store.createIndex("updatedAt", "updatedAt", { unique: false });
          store.createIndex("status", "status", { unique: false });
          store.createIndex("inspectionDate", "identification.inspectionDate", { unique: false });
        }
        if (!db.objectStoreNames.contains(SETTINGS)) {
          db.createObjectStore(SETTINGS, { keyPath: "id" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Impossibile aprire l'archivio locale."));
    });

    return dbPromise;
  }

  async function transaction(storeName, mode, operation) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let request;

      try {
        request = operation(store);
      } catch (error) {
        reject(error);
        return;
      }

      if (request) {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Operazione archivio non riuscita."));
      } else {
        tx.oncomplete = () => resolve();
      }
      tx.onerror = () => reject(tx.error || new Error("Operazione archivio non riuscita."));
      tx.onabort = () => reject(tx.error || new Error("Operazione archivio annullata."));
    });
  }

  async function saveInspection(inspection) {
    const copy = typeof structuredClone === "function" ? structuredClone(inspection) : JSON.parse(JSON.stringify(inspection));
    copy.updatedAt = new Date().toISOString();
    await transaction(INSPECTIONS, "readwrite", (store) => store.put(copy));
    return copy;
  }

  function getInspection(id) {
    return transaction(INSPECTIONS, "readonly", (store) => store.get(id));
  }

  async function getAllInspections() {
    const records = await transaction(INSPECTIONS, "readonly", (store) => store.getAll());
    return records.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  }

  function deleteInspection(id) {
    return transaction(INSPECTIONS, "readwrite", (store) => store.delete(id));
  }

  async function getSettings() {
    const current = await transaction(SETTINGS, "readonly", (store) => store.get("main"));
    if (current) return current;
    const defaults = window.EKData.defaultSettings();
    await saveSettings(defaults);
    return defaults;
  }

  async function saveSettings(settings) {
    const copy = { ...settings, id: "main", updatedAt: new Date().toISOString() };
    await transaction(SETTINGS, "readwrite", (store) => store.put(copy));
    return copy;
  }

  async function createBackup() {
    return {
      app: "EdilKappa Linea Vita",
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      settings: await getSettings(),
      inspections: await getAllInspections(),
    };
  }

  async function restoreBackup(payload, mode = "merge") {
    if (!payload || payload.app !== "EdilKappa Linea Vita" || !Array.isArray(payload.inspections)) {
      throw new Error("Il file selezionato non è un backup valido di EdilKappa Linea Vita.");
    }

    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction([INSPECTIONS, SETTINGS], "readwrite");
      const inspectionsStore = tx.objectStore(INSPECTIONS);
      const settingsStore = tx.objectStore(SETTINGS);

      if (mode === "replace") inspectionsStore.clear();
      payload.inspections.forEach((inspection) => inspectionsStore.put(inspection));
      if (payload.settings) settingsStore.put({ ...payload.settings, id: "main" });

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Ripristino non riuscito."));
      tx.onabort = () => reject(tx.error || new Error("Ripristino annullato."));
    });

    return payload.inspections.length;
  }

  async function clearAllData() {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction([INSPECTIONS, SETTINGS], "readwrite");
      tx.objectStore(INSPECTIONS).clear();
      tx.objectStore(SETTINGS).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Cancellazione non riuscita."));
    });
  }

  async function storageEstimate() {
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      return { usage: estimate.usage || 0, quota: estimate.quota || 0 };
    }
    return { usage: 0, quota: 0 };
  }

  window.EKDB = {
    openDb,
    saveInspection,
    getInspection,
    getAllInspections,
    deleteInspection,
    getSettings,
    saveSettings,
    createBackup,
    restoreBackup,
    clearAllData,
    storageEstimate,
  };
})();
