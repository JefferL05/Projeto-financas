const DB_NAME = "ProjetoFinancasDB";
const DB_VERSION = 4;
let dbPromise;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction;

      if (!db.objectStoreNames.contains("transactions")) {
        const store = db.createObjectStore("transactions", { keyPath: "id" });
        store.createIndex("date", "date", { unique: false });
        store.createIndex("currency", "currency", { unique: false });
        store.createIndex("type", "type", { unique: false });
        store.createIndex("category", "category", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      } else if (event.oldVersion < 2) {
        const store = tx.objectStore("transactions");
        if (!store.indexNames.contains("category")) store.createIndex("category", "category", { unique: false });
      }

      if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings", { keyPath: "key" });
      if (!db.objectStoreNames.contains("categories")) db.createObjectStore("categories", { keyPath: "name" });

      if (!db.objectStoreNames.contains("exchangeRates")) {
        const rates = db.createObjectStore("exchangeRates", { keyPath: "id" });
        rates.createIndex("date", "date", { unique: false });
      }

      if (!db.objectStoreNames.contains("goals")) {
        const goals = db.createObjectStore("goals", { keyPath: "id" });
        goals.createIndex("targetDate", "targetDate", { unique: false });
        goals.createIndex("priority", "priority", { unique: false });
        goals.createIndex("currency", "currency", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAll(storeName) {
  const db = await openDB();
  const tx = db.transaction(storeName, "readonly");
  return requestToPromise(tx.objectStore(storeName).getAll());
}

export async function get(storeName, key) {
  const db = await openDB();
  const tx = db.transaction(storeName, "readonly");
  return requestToPromise(tx.objectStore(storeName).get(key));
}

export async function put(storeName, value) {
  const db = await openDB();
  const tx = db.transaction(storeName, "readwrite");
  await requestToPromise(tx.objectStore(storeName).put(value));
  return value;
}

export async function bulkPut(storeName, values) {
  const db = await openDB();
  const tx = db.transaction(storeName, "readwrite");
  const store = tx.objectStore(storeName);
  values.forEach((value) => store.put(value));
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(values);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function remove(storeName, key) {
  const db = await openDB();
  const tx = db.transaction(storeName, "readwrite");
  await requestToPromise(tx.objectStore(storeName).delete(key));
}

export async function clearStore(storeName) {
  const db = await openDB();
  const tx = db.transaction(storeName, "readwrite");
  await requestToPromise(tx.objectStore(storeName).clear());
}

export async function clearDatabaseData() {
  for (const store of ["transactions", "settings", "categories", "exchangeRates", "goals"]) {
    await clearStore(store);
  }
}

export async function count(storeName) {
  const db = await openDB();
  const tx = db.transaction(storeName, "readonly");
  return requestToPromise(tx.objectStore(storeName).count());
}
