const DEFAULT_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;
const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const RECOVERY_GROUPS = 5;
const RECOVERY_GROUP_SIZE = 4;

function toBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function utf8(value) {
  return new TextEncoder().encode(String(value));
}

async function derive(secret, salt, iterations = DEFAULT_ITERATIONS) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    utf8(secret),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations
    },
    keyMaterial,
    KEY_BITS
  );

  return new Uint8Array(bits);
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

function randomRecoveryCharacter() {
  const limit = 256 - (256 % RECOVERY_ALPHABET.length);
  const byte = new Uint8Array(1);
  do crypto.getRandomValues(byte); while (byte[0] >= limit);
  return RECOVERY_ALPHABET[byte[0] % RECOVERY_ALPHABET.length];
}

export function generateRecoveryCode() {
  const groups = [];
  for (let group = 0; group < RECOVERY_GROUPS; group += 1) {
    let value = "";
    for (let index = 0; index < RECOVERY_GROUP_SIZE; index += 1) value += randomRecoveryCharacter();
    groups.push(value);
  }
  return `PF-${groups.join("-")}`;
}

export function normalizeRecoveryCode(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/^PF-?/, "")
    .replace(/-/g, "");
}

export async function createCredentialVerifier(secret, { iterations = DEFAULT_ITERATIONS } = {}) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const verifier = await derive(secret, salt, iterations);
  return {
    algorithm: "PBKDF2-SHA-256",
    iterations,
    salt: toBase64(salt),
    verifier: toBase64(verifier)
  };
}

export async function verifyCredential(secret, record) {
  if (!record?.salt || !record?.verifier || !Number.isInteger(record?.iterations)) return false;
  const salt = fromBase64(record.salt);
  const expected = fromBase64(record.verifier);
  const actual = await derive(secret, salt, record.iterations);
  return constantTimeEqual(actual, expected);
}

export const AUTH_KDF_DEFAULTS = Object.freeze({
  algorithm: "PBKDF2-SHA-256",
  iterations: DEFAULT_ITERATIONS,
  saltBytes: SALT_BYTES,
  keyBits: KEY_BITS
});