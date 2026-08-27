import {
  createCredentialVerifier,
  generateRecoveryCode,
  normalizeRecoveryCode,
  verifyCredential
} from "./crypto-service.js";

const AUTH_DB_NAME = "ProjetoFinancasAuthDB";
const AUTH_DB_VERSION = 1;
const AUTH_STORE = "auth";
const PROFILE_KEY = "profile";
const VALID_METHODS = new Set(["password", "pin"]);
const VALID_AUTO_LOCKS = new Set([0, 1, 5, 15, 30]);
const LEGACY_RESET_CONFIRMATION = "REDEFINIR";

let authDbPromise;

function openAuthDB() {
  if (authDbPromise) return authDbPromise;
  authDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(AUTH_DB_NAME, AUTH_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(AUTH_STORE)) {
        db.createObjectStore(AUTH_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return authDbPromise;
}

function req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function normalizeUsername(value) {
  const username = String(value ?? "").trim();
  if (!username || username.length > 60) throw new TypeError("Nome de usuário inválido.");
  return username;
}

function validateSecret(secret, method) {
  const value = String(secret ?? "");
  if (!VALID_METHODS.has(method)) throw new TypeError("Método de acesso inválido.");
  if (value.length > 128) throw new TypeError("Credencial muito longa.");
  if (method === "pin") {
    if (!/^\d{4,8}$/.test(value)) throw new TypeError("O PIN deve conter de 4 a 8 dígitos.");
  } else if (value.length < 8) {
    throw new TypeError("A senha deve ter pelo menos 8 caracteres.");
  }
  return value;
}

async function writeProfile(profile) {
  const db = await openAuthDB();
  const tx = db.transaction(AUTH_STORE, "readwrite");
  await req(tx.objectStore(AUTH_STORE).put({ key: PROFILE_KEY, ...profile }));
  return profile;
}

async function deleteProfile() {
  const db = await openAuthDB();
  const tx = db.transaction(AUTH_STORE, "readwrite");
  await req(tx.objectStore(AUTH_STORE).delete(PROFILE_KEY));
}

async function buildRecoveryVerifier(recoveryCode) {
  const normalized = normalizeRecoveryCode(recoveryCode);
  const record = await createCredentialVerifier(normalized);
  return {
    recoveryAlgorithm: record.algorithm,
    recoveryIterations: record.iterations,
    recoverySalt: record.salt,
    recoveryVerifier: record.verifier,
    recoveryCreatedAt: new Date().toISOString()
  };
}

function recoveryRecord(profile) {
  if (!profile?.recoverySalt || !profile?.recoveryVerifier || !Number.isInteger(profile?.recoveryIterations)) return null;
  return {
    salt: profile.recoverySalt,
    verifier: profile.recoveryVerifier,
    iterations: profile.recoveryIterations,
    algorithm: profile.recoveryAlgorithm
  };
}

export function hasRecoveryConfigured(profile) {
  return Boolean(recoveryRecord(profile));
}

export async function getAuthProfile() {
  const db = await openAuthDB();
  const tx = db.transaction(AUTH_STORE, "readonly");
  const record = await req(tx.objectStore(AUTH_STORE).get(PROFILE_KEY));
  if (!record) return null;
  const { key, ...profile } = record;
  return profile;
}

export async function createProtectionWithRecovery({ username, secret, method = "password" }) {
  if (await getAuthProfile()) throw new Error("A proteção de acesso já está configurada.");
  const safeUsername = normalizeUsername(username);
  const safeSecret = validateSecret(secret, method);
  const verifier = await createCredentialVerifier(safeSecret);
  const recoveryCode = generateRecoveryCode();
  const recovery = await buildRecoveryVerifier(recoveryCode);
  const profile = await writeProfile({
    version: 2,
    username: safeUsername,
    method,
    ...verifier,
    ...recovery,
    autoLockMinutes: 5,
    hideSensitiveNotificationsWhenLocked: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  return { profile, recoveryCode };
}

export async function createProtection(options) {
  const { profile } = await createProtectionWithRecovery(options);
  return profile;
}

export async function verifyAccess({ username, secret }) {
  const profile = await getAuthProfile();
  if (!profile) return { ok: false, reason: "not-configured" };
  if (String(username ?? "").trim() !== profile.username) return { ok: false, reason: "invalid-credentials" };
  const ok = await verifyCredential(String(secret ?? ""), profile);
  return { ok, reason: ok ? null : "invalid-credentials", profile };
}

export async function verifyRecoveryCode({ username, recoveryCode }) {
  const profile = await getAuthProfile();
  if (!profile) return { ok: false, reason: "not-configured" };
  if (String(username ?? "").trim() !== profile.username) return { ok: false, reason: "invalid-recovery" };
  const record = recoveryRecord(profile);
  if (!record) return { ok: false, reason: "recovery-not-configured" };
  const normalized = normalizeRecoveryCode(recoveryCode);
  if (!normalized) return { ok: false, reason: "invalid-recovery" };
  const ok = await verifyCredential(normalized, record);
  return { ok, reason: ok ? null : "invalid-recovery", profile };
}

export async function resetCredentialWithRecovery({ username, recoveryCode, newSecret, method = "password" }) {
  const result = await verifyRecoveryCode({ username, recoveryCode });
  if (!result.ok) throw new Error("Código de recuperação inválido.");
  const safeSecret = validateSecret(newSecret, method);
  const verifier = await createCredentialVerifier(safeSecret);
  const nextRecoveryCode = generateRecoveryCode();
  const recovery = await buildRecoveryVerifier(nextRecoveryCode);
  const profile = await writeProfile({
    ...result.profile,
    version: 2,
    method,
    ...verifier,
    ...recovery,
    updatedAt: new Date().toISOString()
  });
  return { profile, recoveryCode: nextRecoveryCode };
}

export async function resetLegacyProtection({ username, confirmation }) {
  const profile = await getAuthProfile();
  if (!profile) return { ok: true, reason: "not-configured" };
  if (hasRecoveryConfigured(profile)) {
    throw new Error("Este acesso já possui código de recuperação. Use o código salvo.");
  }
  if (String(username ?? "").trim() !== profile.username) {
    throw new Error("Nome de usuário não corresponde ao acesso local.");
  }
  if (String(confirmation ?? "").trim().toUpperCase() !== LEGACY_RESET_CONFIRMATION) {
    throw new Error(`Digite ${LEGACY_RESET_CONFIRMATION} para confirmar.`);
  }
  await deleteProfile();
  return { ok: true, reason: "legacy-access-reset" };
}

export async function regenerateRecoveryCode(currentSecret) {
  const profile = await getAuthProfile();
  if (!profile) throw new Error("Proteção não configurada.");
  const currentOk = await verifyCredential(String(currentSecret ?? ""), profile);
  if (!currentOk) throw new Error("Credencial atual incorreta.");
  const recoveryCode = generateRecoveryCode();
  const recovery = await buildRecoveryVerifier(recoveryCode);
  const nextProfile = await writeProfile({ ...profile, version: 2, ...recovery, updatedAt: new Date().toISOString() });
  return { profile: nextProfile, recoveryCode };
}

export async function changeCredential({ currentSecret, newSecret, method }) {
  const profile = await getAuthProfile();
  if (!profile) throw new Error("Proteção não configurada.");
  const currentOk = await verifyCredential(String(currentSecret ?? ""), profile);
  if (!currentOk) throw new Error("Credencial atual incorreta.");
  const nextMethod = method || profile.method;
  const safeSecret = validateSecret(newSecret, nextMethod);
  const verifier = await createCredentialVerifier(safeSecret);
  return writeProfile({
    ...profile,
    method: nextMethod,
    ...verifier,
    updatedAt: new Date().toISOString()
  });
}

export async function updateAuthPreferences({ autoLockMinutes, hideSensitiveNotificationsWhenLocked }) {
  const profile = await getAuthProfile();
  if (!profile) throw new Error("Proteção não configurada.");
  const minutes = Number(autoLockMinutes);
  if (!VALID_AUTO_LOCKS.has(minutes)) throw new TypeError("Tempo de bloqueio inválido.");
  return writeProfile({
    ...profile,
    autoLockMinutes: minutes,
    hideSensitiveNotificationsWhenLocked: Boolean(hideSensitiveNotificationsWhenLocked),
    updatedAt: new Date().toISOString()
  });
}

export async function disableProtection(secret) {
  const profile = await getAuthProfile();
  if (!profile) return;
  const ok = await verifyCredential(String(secret ?? ""), profile);
  if (!ok) throw new Error("Credencial atual incorreta.");
  await deleteProfile();
}

export const AUTH_METADATA = Object.freeze({
  dbName: AUTH_DB_NAME,
  dbVersion: AUTH_DB_VERSION,
  methods: [...VALID_METHODS],
  autoLockOptions: [...VALID_AUTO_LOCKS],
  legacyResetConfirmation: LEGACY_RESET_CONFIRMATION
});