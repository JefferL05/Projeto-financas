import { DB_VERSION, STORE_NAMES, atomicPutMany, getAll, normalizeRecord } from "../db.js";

export const BACKUP_SCHEMA_VERSION = 6;
export const APP_VERSION = "2.0.0";
export const MAX_BACKUP_BYTES = 8 * 1024 * 1024;

function emptyStores() {
  return Object.fromEntries(STORE_NAMES.map((name) => [name, []]));
}

function normalizeLegacySettings(settings) {
  if (Array.isArray(settings)) return settings;
  if (!settings || typeof settings !== "object") return [];
  return Object.entries(settings).map(([key, value]) => ({ key, value }));
}

function legacyWallet(currency) {
  return {
    id: `account-wallet-${currency.toLowerCase()}`,
    name: `Carteira ${currency}`,
    type: "cash",
    currency,
    openingBalance: 0,
    onBudget: true,
    includeInNetWorth: true,
    archived: false,
    color: currency === "BRL" ? "#3fd59a" : "#7dd3fc",
    icon: "wallet",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastReconciledAt: null
  };
}

function ensureAccountsForLegacyStores(stores) {
  if (!Array.isArray(stores.accounts)) stores.accounts = [];

  const accountIds = new Set(stores.accounts.map((account) => account?.id).filter(Boolean));
  const currenciesInUse = new Set(
    (stores.transactions || [])
      .map((transaction) => transaction?.currency)
      .filter((currency) => currency === "BRL" || currency === "PYG")
  );

  for (const currency of currenciesInUse) {
    const id = `account-wallet-${currency.toLowerCase()}`;
    if (!accountIds.has(id)) {
      stores.accounts.push(legacyWallet(currency));
      accountIds.add(id);
    }
  }

  stores.transactions = (stores.transactions || []).map((transaction) => {
    if (transaction?.accountId || !["BRL", "PYG"].includes(transaction?.currency)) return transaction;

    return {
      ...transaction,
      accountId: `account-wallet-${transaction.currency.toLowerCase()}`,
      status: ["pending", "cleared", "reconciled"].includes(transaction.status)
        ? transaction.status
        : "cleared"
    };
  });

  return stores;
}

export function upgradeLegacyBackup(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new TypeError("Arquivo de backup inválido.");
  }

  const currentSchema = Number(data.schemaVersion) === BACKUP_SCHEMA_VERSION && data.stores;
  const stores = emptyStores();
  const sourceStores = data.stores && typeof data.stores === "object" ? data.stores : data;

  for (const storeName of STORE_NAMES) {
    if (storeName === "settings") {
      stores.settings = normalizeLegacySettings(sourceStores.settings);
    } else if (Array.isArray(sourceStores[storeName])) {
      stores[storeName] = sourceStores[storeName].map((record) => ({ ...record }));
    }
  }

  if (!stores.transactions.length && !stores.categories.length && !stores.settings.length) {
    throw new TypeError("O arquivo não parece ser um backup do Projeto Finanças.");
  }

  ensureAccountsForLegacyStores(stores);

  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: data.appVersion || (currentSchema ? APP_VERSION : "legacy"),
    dbVersion: Number(data.dbVersion) || (currentSchema ? DB_VERSION : 5),
    exportedAt: data.exportedAt || null,
    ...(currentSchema ? {} : { migratedFromSchema: Number(data.schemaVersion) || 3 }),
    stores
  };
}

export async function createBackupObject() {
  const stores = {};
  for (const storeName of STORE_NAMES) stores[storeName] = await getAll(storeName);

  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    dbVersion: DB_VERSION,
    exportedAt: new Date().toISOString(),
    stores
  };
}

export async function createBackupJSON() {
  return JSON.stringify(await createBackupObject(), null, 2);
}

export function validateBackupObject(input) {
  let data;
  try {
    data = upgradeLegacyBackup(input);
  } catch (error) {
    return { ok: false, reason: error.message || "Backup inválido." };
  }

  if (!data.stores || typeof data.stores !== "object") {
    return { ok: false, reason: "Backup não contém stores." };
  }

  const normalized = {};
  try {
    for (const storeName of STORE_NAMES) {
      const records = data.stores[storeName] ?? [];
      if (!Array.isArray(records)) throw new TypeError(`Store ${storeName} inválida.`);
      if (records.length > 10000) throw new TypeError(`Store ${storeName} excede o limite de registros.`);
      normalized[storeName] = records.map((record) => normalizeRecord(storeName, record));
    }
  } catch (error) {
    return { ok: false, reason: error.message || "Registro inválido no backup." };
  }

  return { ok: true, normalized, upgraded: data };
}

export async function parseBackupFile(file) {
  if (!file || file.size > MAX_BACKUP_BYTES) {
    throw new TypeError("O arquivo excede o limite de 8 MB ou está ausente.");
  }

  const text = await file.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new TypeError("O arquivo não contém JSON válido.");
  }

  const validation = validateBackupObject(data);
  if (!validation.ok) throw new TypeError(validation.reason);
  return { source: validation.upgraded, stores: validation.normalized };
}

export async function previewRestore(stores) {
  const preview = {};

  for (const storeName of STORE_NAMES) {
    const existing = await getAll(storeName);
    const currentKeys = new Set(existing.map((item) => item.id ?? item.key ?? item.name));
    const incoming = stores[storeName] || [];
    let create = 0;
    let update = 0;

    for (const record of incoming) {
      const key = record.id ?? record.key ?? record.name;
      if (currentKeys.has(key)) update += 1;
      else create += 1;
    }

    preview[storeName] = {
      incoming: incoming.length,
      create,
      update,
      ignored: 0,
      existing: existing.length
    };
  }

  return preview;
}

export async function restoreBackup(stores, { mode = "merge" } = {}) {
  if (!["merge", "replace"].includes(mode)) throw new TypeError("Modo de restauração inválido.");

  const validation = validateBackupObject({ schemaVersion: BACKUP_SCHEMA_VERSION, stores });
  if (!validation.ok) throw new TypeError(validation.reason);

  await atomicPutMany(validation.normalized, {
    clearFirst: mode === "replace" ? STORE_NAMES : []
  });

  return {
    ok: true,
    mode,
    counts: Object.fromEntries(
      STORE_NAMES.map((name) => [name, validation.normalized[name].length])
    )
  };
}
