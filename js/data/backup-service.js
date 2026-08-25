import { DB_VERSION, STORE_NAMES, atomicPutMany, getAll, normalizeRecord } from "../db.js";

export const BACKUP_SCHEMA_VERSION = 6;
export const APP_VERSION = "2.0.0";
export const MAX_BACKUP_BYTES = 8 * 1024 * 1024;

export async function createBackupObject() {
  const stores = {};
  for (const storeName of STORE_NAMES) {
    stores[storeName] = await getAll(storeName);
  }

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

export function validateBackupObject(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, reason: "Arquivo de backup inválido." };
  }
  if (Number(data.schemaVersion) !== BACKUP_SCHEMA_VERSION) {
    return { ok: false, reason: `Versão de backup não suportada: ${data.schemaVersion ?? "ausente"}.` };
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

  return { ok: true, normalized };
}

export async function parseBackupFile(file) {
  if (!file || file.size > MAX_BACKUP_BYTES) {
    throw new TypeError("O arquivo excede o limite de 8 MB ou está ausente.");
  }
  const text = await file.text();
  const data = JSON.parse(text);
  const validation = validateBackupObject(data);
  if (!validation.ok) throw new TypeError(validation.reason);
  return { source: data, stores: validation.normalized };
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
    counts: Object.fromEntries(STORE_NAMES.map((name) => [name, validation.normalized[name].length]))
  };
}
