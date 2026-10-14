// Minimale IndexedDB-Schicht. Alle Daten bleiben lokal im Browser.

const DB_NAME = "shruum-stagebuilder";
const DB_VERSION = 1;
const STORES = ["ranges", "stages", "settings"];

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: name === "settings" ? "key" : "id" });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const objectStore = transaction.objectStore(store);
        let result;
        Promise.resolve(fn(objectStore)).then((value) => {
          result = value;
        });
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      }),
  );
}

const req = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

export const storage = {
  all: (store) => tx(store, "readonly", (s) => req(s.getAll())),
  put: (store, value) => tx(store, "readwrite", (s) => req(s.put(value))),
  putMany: (store, values) => tx(store, "readwrite", (s) => Promise.all(values.map((v) => req(s.put(v))))),
  remove: (store, id) => tx(store, "readwrite", (s) => req(s.delete(id))),
  async getSetting(key, fallback) {
    const row = await tx("settings", "readonly", (s) => req(s.get(key)));
    return row ? row.value : fallback;
  },
  setSetting: (key, value) => tx("settings", "readwrite", (s) => req(s.put({ key, value }))),
  // Bittet den Browser, die Daten nicht automatisch zu löschen.
  async persist() {
    try {
      if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
    } catch {
      /* nicht unterstützt */
    }
    return false;
  },
};
