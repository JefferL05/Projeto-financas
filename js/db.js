const DB_NAME = "ProjetoFinancasDB";
export const DB_VERSION = 6;

export const STORE_NAMES = [
  "transactions",
  "settings",
  "categories",
  "exchangeRates",
  "goals",
  "budgets",
  "accounts",
  "schedules",
  "rules",
  "reconciliations"
];

const STORES = new Set(STORE_NAMES);
const ACCOUNT_TYPES = new Set([
  "cash",
  "checking",
  "savings",
  "digital_wallet",
  "credit_card",
  "investment",
  "loan",
  "asset",
  "liability"
]);
const TRANSACTION_TYPES = new Set(["income", "expense", "transfer"]);
const TRANSACTION_STATUS = new Set(["pending", "cleared", "reconciled"]);
const CURRENCIES = new Set(["BRL", "PYG"]);

let dbPromise;

function ensureIndex(store, name, keyPath, options = { unique: false }) {
  if (!store.indexNames.contains(name)) store.createIndex(name, keyPath, options);
}

function defaultAccount(currency) {
  const now = new Date().toISOString();
  return {
    id: `account-wallet-${currency.toLowerCase()}`,
    name: currency === "BRL" ? "Carteira BRL" : "Carteira PYG",
    type: "cash",
    currency,
    openingBalance: 0,
    onBudget: true,
    includeInNetWorth: true,
    archived: false,
    color: currency === "BRL" ? "#3fd59a" : "#7dd3fc",
    icon: "wallet",
    createdAt: now,
    updatedAt: now,
    lastReconciledAt: null
  };
}

export function openDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction;

      let transactions;
      if (!db.objectStoreNames.contains("transactions")) {
        transactions = db.createObjectStore("transactions", { keyPath: "id" });
      } else {
        transactions = tx.objectStore("transactions");
      }

      ensureIndex(transactions, "date", "date");
      ensureIndex(transactions, "currency", "currency");
      ensureIndex(transactions, "type", "type");
      ensureIndex(transactions, "category", "category");
      ensureIndex(transactions, "createdAt", "createdAt");
      ensureIndex(transactions, "accountId", "accountId");
      ensureIndex(transactions, "status", "status");
      ensureIndex(transactions, "transferId", "transferId");
      ensureIndex(transactions, "scheduleId", "scheduleId");

      if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings", { keyPath: "key" });
      if (!db.objectStoreNames.contains("categories")) db.createObjectStore("categories", { keyPath: "name" });

      if (!db.objectStoreNames.contains("exchangeRates")) {
        const rates = db.createObjectStore("exchangeRates", { keyPath: "id" });
        ensureIndex(rates, "date", "date");
      }

      if (!db.objectStoreNames.contains("goals")) {
        const goals = db.createObjectStore("goals", { keyPath: "id" });
        ensureIndex(goals, "targetDate", "targetDate");
        ensureIndex(goals, "priority", "priority");
        ensureIndex(goals, "currency", "currency");
      }

      if (!db.objectStoreNames.contains("budgets")) {
        const budgets = db.createObjectStore("budgets", { keyPath: "id" });
        ensureIndex(budgets, "period", "period");
        ensureIndex(budgets, "category", "category");
        ensureIndex(budgets, "currency", "currency");
      }

      let accounts;
      if (!db.objectStoreNames.contains("accounts")) {
        accounts = db.createObjectStore("accounts", { keyPath: "id" });
        ensureIndex(accounts, "currency", "currency");
        ensureIndex(accounts, "type", "type");
        ensureIndex(accounts, "archived", "archived");
      } else {
        accounts = tx.objectStore("accounts");
      }

      if (!db.objectStoreNames.contains("schedules")) {
        const schedules = db.createObjectStore("schedules", { keyPath: "id" });
        ensureIndex(schedules, "nextDueDate", "nextDueDate");
        ensureIndex(schedules, "accountId", "accountId");
        ensureIndex(schedules, "active", "active");
        ensureIndex(schedules, "kind", "kind");
      }

      if (!db.objectStoreNames.contains("rules")) {
        const rules = db.createObjectStore("rules", { keyPath: "id" });
        ensureIndex(rules, "enabled", "enabled");
        ensureIndex(rules, "priority", "priority");
      }

      if (!db.objectStoreNames.contains("reconciliations")) {
        const reconciliations = db.createObjectStore("reconciliations", { keyPath: "id" });
        ensureIndex(reconciliations, "accountId", "accountId");
        ensureIndex(reconciliations, "date", "date");
      }

      if (event.oldVersion < 6) {
        accounts.put(defaultAccount("BRL"));
        accounts.put(defaultAccount("PYG"));

        const cursorRequest = transactions.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;

          const record = cursor.value;
          let changed = false;

          if (!record.accountId && CURRENCIES.has(record.currency)) {
            record.accountId = `account-wallet-${record.currency.toLowerCase()}`;
            changed = true;
          }

          if (!TRANSACTION_STATUS.has(record.status)) {
            record.status = "cleared";
            record.clearedAt = record.updatedAt || record.createdAt || null;
            changed = true;
          }

          if (record.currency === "BRL" && !Number.isFinite(Number(record.exchangeRateSnapshot))) {
            record.exchangeRateSnapshot = null;
            changed = true;
          }

          if (changed) cursor.update(record);
          cursor.continue();
        };
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
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

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Transação IndexedDB cancelada."));
  });
}

function cleanText(value, max = 120) {
  return String(value ?? "")
    .replace(/[<>\u0000-\u001f]/g, "")
    .trim()
    .slice(0, max);
}

function validId(id) {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

function validDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return false;
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
}

function validCurrency(currency) {
  return CURRENCIES.has(currency);
}

function validAmount(value, currency, { allowZero = true } = {}) {
  const amount = Number(value);
  const max = currency === "PYG" ? 1_000_000_000_000 : 100_000_000;
  return Number.isFinite(amount) && (allowZero ? amount >= 0 : amount > 0) && amount <= max;
}

export function normalizeRecord(storeName, value) {
  if (!STORES.has(storeName) || !value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Registro inválido.");
  }

  if (storeName === "transactions") {
    if (
      !validId(value.id) ||
      !TRANSACTION_TYPES.has(value.type) ||
      !validCurrency(value.currency) ||
      !validAmount(value.amount, value.currency, { allowZero: false }) ||
      !validDate(value.date)
    ) {
      throw new TypeError("Transação inválida.");
    }

    if (value.accountId && !validId(value.accountId)) throw new TypeError("Conta inválida na transação.");
    if (value.transferId && !validId(value.transferId)) throw new TypeError("Transferência inválida.");
    if (value.scheduleId && !validId(value.scheduleId)) throw new TypeError("Agendamento inválido.");

    return {
      ...value,
      amount: Number(value.amount),
      category: cleanText(value.category || "Outros", 60) || "Outros",
      description: cleanText(value.description || value.category || "Lançamento", 160),
      tags: Array.isArray(value.tags) ? value.tags.slice(0, 12).map((item) => cleanText(item, 40)).filter(Boolean) : [],
      status: TRANSACTION_STATUS.has(value.status) ? value.status : "cleared",
      exchangeRateSnapshot: value.currency === "BRL" && Number(value.exchangeRateSnapshot) > 0
        ? Number(value.exchangeRateSnapshot)
        : null
    };
  }

  if (storeName === "categories") {
    const name = cleanText(value.name, 60);
    if (!name) throw new TypeError("Categoria inválida.");
    return { ...value, name };
  }

  if (storeName === "goals") {
    if (
      !validId(value.id) ||
      !validCurrency(value.currency) ||
      !validAmount(value.target, value.currency, { allowZero: false }) ||
      !validAmount(value.current || 0, value.currency) ||
      !validDate(value.targetDate)
    ) {
      throw new TypeError("Meta inválida.");
    }
    return {
      ...value,
      name: cleanText(value.name, 80),
      target: Number(value.target),
      current: Number(value.current || 0),
      monthly: Math.max(0, Number(value.monthly || 0))
    };
  }

  if (storeName === "budgets") {
    if (
      !validId(value.id) ||
      !validCurrency(value.currency) ||
      !validAmount(value.limit, value.currency, { allowZero: false }) ||
      !/^\d{4}-\d{2}$/.test(value.period || "")
    ) {
      throw new TypeError("Orçamento inválido.");
    }
    return {
      ...value,
      category: cleanText(value.category, 60),
      limit: Number(value.limit),
      rollover: Boolean(value.rollover)
    };
  }

  if (storeName === "exchangeRates") {
    if (!validId(value.id) || !Number.isFinite(Number(value.rate)) || Number(value.rate) <= 0 || !validDate(value.date)) {
      throw new TypeError("Cotação inválida.");
    }
    return {
      ...value,
      rate: Number(value.rate),
      source: cleanText(value.source, 60)
    };
  }

  if (storeName === "settings") {
    if (!/^[A-Za-z0-9_-]{1,60}$/.test(String(value.key || ""))) throw new TypeError("Configuração inválida.");
    return value;
  }

  if (storeName === "accounts") {
    if (
      !validId(value.id) ||
      !cleanText(value.name, 80) ||
      !ACCOUNT_TYPES.has(value.type) ||
      !validCurrency(value.currency) ||
      !validAmount(Math.abs(Number(value.openingBalance || 0)), value.currency)
    ) {
      throw new TypeError("Conta inválida.");
    }
    return {
      ...value,
      name: cleanText(value.name, 80),
      openingBalance: Number(value.openingBalance || 0),
      onBudget: value.onBudget !== false,
      includeInNetWorth: value.includeInNetWorth !== false,
      archived: Boolean(value.archived),
      color: cleanText(value.color || "", 24),
      icon: cleanText(value.icon || "wallet", 32)
    };
  }

  if (storeName === "schedules") {
    if (
      !validId(value.id) ||
      !["expense", "income", "transfer", "subscription", "installment", "future"].includes(value.kind) ||
      !validCurrency(value.currency) ||
      !validAmount(value.amount, value.currency, { allowZero: false }) ||
      !validDate(value.nextDueDate) ||
      !validId(value.accountId)
    ) {
      throw new TypeError("Agendamento inválido.");
    }
    return {
      ...value,
      name: cleanText(value.name, 100),
      amount: Number(value.amount),
      category: cleanText(value.category || "Outros", 60),
      active: value.active !== false,
      autoPost: Boolean(value.autoPost),
      reminderDays: Math.max(0, Math.min(90, Number(value.reminderDays || 0)))
    };
  }

  if (storeName === "rules") {
    if (!validId(value.id) || !cleanText(value.name, 100) || !Array.isArray(value.conditions) || !Array.isArray(value.actions)) {
      throw new TypeError("Regra inválida.");
    }
    return {
      ...value,
      name: cleanText(value.name, 100),
      enabled: value.enabled !== false,
      priority: Number.isFinite(Number(value.priority)) ? Number(value.priority) : 100
    };
  }

  if (storeName === "reconciliations") {
    if (!validId(value.id) || !validId(value.accountId) || !validDate(value.date) || !Number.isFinite(Number(value.statementBalance))) {
      throw new TypeError("Conciliação inválida.");
    }
    return {
      ...value,
      statementBalance: Number(value.statementBalance),
      difference: Number(value.difference || 0)
    };
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

export async function queryIndex(storeName, indexName, query = null, { limit = 500, direction = "next" } = {}) {
  if (!STORES.has(storeName)) throw new TypeError("Store inválida.");
  const db = await openDB();
  const tx = db.transaction(storeName, "readonly");
  const index = tx.objectStore(storeName).index(indexName);
  const results = [];

  return new Promise((resolve, reject) => {
    const request = index.openCursor(query, direction);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || results.length >= limit) {
        resolve(results);
        return;
      }
      results.push(cursor.value);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

export async function put(storeName, value) {
  const safe = normalizeRecord(storeName, value);
  const db = await openDB();
  const tx = db.transaction(storeName, "readwrite");
  tx.objectStore(storeName).put(safe);
  await transactionDone(tx);
  return safe;
}

export async function bulkPut(storeName, values) {
  if (!Array.isArray(values) || values.length > 10000) {
    throw new TypeError("Importação inválida ou grande demais.");
  }
  const safeValues = values.map((value) => normalizeRecord(storeName, value));
  const db = await openDB();
  const tx = db.transaction(storeName, "readwrite");
  const store = tx.objectStore(storeName);
  safeValues.forEach((value) => store.put(value));
  await transactionDone(tx);
  return safeValues;
}

export async function runAtomic(storeNames, mode, callback) {
  const uniqueStores = [...new Set(storeNames)];
  uniqueStores.forEach((name) => {
    if (!STORES.has(name)) throw new TypeError(`Store inválida: ${name}`);
  });

  const db = await openDB();
  const tx = db.transaction(uniqueStores, mode);
  const stores = Object.fromEntries(uniqueStores.map((name) => [name, tx.objectStore(name)]));
  let result;

  try {
    result = await callback(stores, tx);
  } catch (error) {
    tx.abort();
    throw error;
  }

  await transactionDone(tx);
  return result;
}

export async function atomicPutMany(recordsByStore, { clearFirst = [] } = {}) {
  const storeNames = Object.keys(recordsByStore);
  return runAtomic(storeNames, "readwrite", (stores) => {
    for (const storeName of storeNames) {
      if (clearFirst.includes(storeName)) stores[storeName].clear();
      const values = recordsByStore[storeName] || [];
      values.map((value) => normalizeRecord(storeName, value)).forEach((value) => stores[storeName].put(value));
    }
  });
}

export async function remove(storeName, key) {
  if (!STORES.has(storeName)) throw new TypeError("Store inválida.");
  const db = await openDB();
  const tx = db.transaction(storeName, "readwrite");
  tx.objectStore(storeName).delete(key);
  await transactionDone(tx);
}

export async function clearStore(storeName) {
  if (!STORES.has(storeName)) throw new TypeError("Store inválida.");
  const db = await openDB();
  const tx = db.transaction(storeName, "readwrite");
  tx.objectStore(storeName).clear();
  await transactionDone(tx);
}

export async function clearDatabaseData() {
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES, "readwrite");
  STORE_NAMES.forEach((name) => tx.objectStore(name).clear());
  await transactionDone(tx);
}

export async function count(storeName) {
  const db = await openDB();
  const tx = db.transaction(storeName, "readonly");
  return requestToPromise(tx.objectStore(storeName).count());
}
