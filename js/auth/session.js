const SESSION_KEY = "pf-auth-session-v1";
let memorySession = null;
let inactivityTimer = null;
let activityHandler = null;

function readStorage() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return memorySession;
  }
}

function writeStorage(value) {
  memorySession = value;
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(value)); } catch {}
}

export function unlockSession(profile) {
  const now = Date.now();
  writeStorage({
    version: profile?.version || 1,
    username: profile?.username || "",
    unlockedAt: now,
    lastActivityAt: now
  });
}

export function lockSession() {
  memorySession = null;
  try { sessionStorage.removeItem(SESSION_KEY); } catch {}
}

export function touchSession() {
  const current = readStorage();
  if (!current) return;
  current.lastActivityAt = Date.now();
  writeStorage(current);
}

export function isSessionUnlocked(profile) {
  const current = readStorage();
  if (!current || !profile || current.username !== profile.username) return false;
  const minutes = Number(profile.autoLockMinutes ?? 5);
  if (minutes === 0) return true;
  return Date.now() - Number(current.lastActivityAt || 0) < minutes * 60_000;
}

export function stopAutoLock() {
  if (inactivityTimer) clearInterval(inactivityTimer);
  inactivityTimer = null;
  if (activityHandler && typeof window !== "undefined") {
    ["pointerdown", "keydown", "touchstart"].forEach((event) => window.removeEventListener(event, activityHandler, true));
  }
  activityHandler = null;
}

export function startAutoLock(profile, onLock) {
  stopAutoLock();
  const minutes = Number(profile?.autoLockMinutes ?? 5);
  if (minutes === 0 || typeof window === "undefined") return;

  activityHandler = () => touchSession();
  ["pointerdown", "keydown", "touchstart"].forEach((event) => window.addEventListener(event, activityHandler, true));
  inactivityTimer = setInterval(() => {
    if (!isSessionUnlocked(profile)) {
      stopAutoLock();
      lockSession();
      onLock?.();
    }
  }, 15_000);
}

export function sessionSnapshot() {
  const current = readStorage();
  return current ? { ...current } : null;
}