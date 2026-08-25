const DB_NAME = "ProjetoFinancasDB";
const DB_VERSION = 5;
const STORES = new Set(["transactions", "settings", "categories", "exchangeRates", "goals", "budgets"]);
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
      } else {
        const store = tx.objectStore("transactions");
        if (!store.indexNames.contains("category")) store.createIndex("category", "category", { unique: false });
        if (!store.indexNames.contains("date")) store.createIndex("date", "date", { unique: false });
        if (!store.indexNames.contains("currency")) store.createIndex("currency", "currency", { unique: false });
        if (!store.indexNames.contains("type")) store.createIndex("type", "type", { unique: false });
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
      if (!db.objectStoreNames.contains("budgets")) {
        const budgets = db.createObjectStore("budgets", { keyPath: "id" });
        budgets.createIndex("period", "period", { unique: false });
        budgets.createIndex("category", "category", { unique: false });
        budgets.createIndex("currency", "currency", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => console.warn("Atualização do banco aguardando fechamento de outra aba.");
  });
  return dbPromise;
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function cleanText(value, max = 120) {
  return String(value ?? "").replace(/[<>\u0000-\u001f]/g, "").trim().slice(0, max);
}
function validId(id) { return typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id); }
function validDate(date) { return /^\d{4}-\d{2}-\d{2}$/.test(date || "") && !Number.isNaN(new Date(`${date}T00:00:00`).getTime()); }
function validCurrency(c) { return c === "BRL" || c === "PYG"; }
function validAmount(n, currency) {
  const value = Number(n);
  const max = currency === "PYG" ? 1_000_000_000_000 : 100_000_000;
  return Number.isFinite(value) && value >= 0 && value <= max;
}

function normalizeRecord(storeName, value) {
  if (!STORES.has(storeName) || !value || typeof value !== "object") throw new TypeError("Registro inválido.");

  if (storeName === "transactions") {
    if (!validId(value.id) || !["income", "expense"].includes(value.type) || !validCurrency(value.currency) || !validAmount(value.amount, value.currency) || !validDate(value.date)) throw new TypeError("Transação inválida.");
    return {
      ...value,
      amount: Number(value.amount),
      category: cleanText(value.category || "Outros", 60) || "Outros",
      description: cleanText(value.description || value.category || "Lançamento", 160),
      tags: Array.isArray(value.tags) ? value.tags.slice(0, 12).map((x) => cleanText(x, 40)).filter(Boolean) : []
    };
  }
  if (storeName === "categories") {
    const name = cleanText(value.name, 60);
    if (!name) throw new TypeError("Categoria inválida.");
    return { ...value, name };
  }
  if (storeName === "goals") {
    if (!validId(value.id) || !validCurrency(value.currency) || !validAmount(value.target, value.currency) || !validAmount(value.current || 0, value.currency) || !validDate(value.targetDate)) throw new TypeError("Meta inválida.");
    return { ...value, name: cleanText(value.name, 80), target: Number(value.target), current: Number(value.current || 0), monthly: Math.max(0, Number(value.monthly || 0)) };
  }
  if (storeName === "budgets") {
    if (!validId(value.id) || !validCurrency(value.currency) || !validAmount(value.limit, value.currency) || !/^\d{4}-\d{2}$/.test(value.period || "")) throw new TypeError("Orçamento inválido.");
    return { ...value, category: cleanText(value.category, 60), limit: Number(value.limit) };
  }
  if (storeName === "exchangeRates") {
    if (!validId(value.id) || !Number.isFinite(Number(value.rate)) || Number(value.rate) <= 0) throw new TypeError("Cotação inválida.");
    return { ...value, rate: Number(value.rate), source: cleanText(value.source, 60) };
  }
  if (storeName === "settings") {
    if (!/^[A-Za-z0-9_-]{1,60}$/.test(String(value.key || ""))) throw new TypeError("Configuração inválida.");
    return value;
  }
  return value;
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
  const safe = normalizeRecord(storeName, value);
  const db = await openDB();
  const tx = db.transaction(storeName, "readwrite");
  await requestToPromise(tx.objectStore(storeName).put(safe));
  return safe;
}
export async function bulkPut(storeName, values) {
  if (!Array.isArray(values) || values.length > 10000) throw new TypeError("Importação inválida ou grande demais.");
  const safeValues = values.map((value) => normalizeRecord(storeName, value));
  const db = await openDB();
  const tx = db.transaction(storeName, "readwrite");
  const store = tx.objectStore(storeName);
  safeValues.forEach((value) => store.put(value));
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(safeValues);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
export async function remove(storeName, key) {
  if (!STORES.has(storeName)) throw new TypeError("Store inválida.");
  const db = await openDB();
  const tx = db.transaction(storeName, "readwrite");
  await requestToPromise(tx.objectStore(storeName).delete(key));
}
export async function clearStore(storeName) {
  if (!STORES.has(storeName)) throw new TypeError("Store inválida.");
  const db = await openDB();
  const tx = db.transaction(storeName, "readwrite");
  await requestToPromise(tx.objectStore(storeName).clear());
}
export async function clearDatabaseData() {
  for (const store of STORES) await clearStore(store);
}
export async function count(storeName) {
  const db = await openDB();
  const tx = db.transaction(storeName, "readonly");
  return requestToPromise(tx.objectStore(storeName).count());
}
