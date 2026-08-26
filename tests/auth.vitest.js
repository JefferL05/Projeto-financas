import { beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import {
  createProtection,
  getAuthProfile,
  verifyAccess,
  changeCredential,
  updateAuthPreferences
} from "../js/auth/auth-service.js";
import { createCredentialVerifier, verifyCredential } from "../js/auth/crypto-service.js";

async function resetAuthDB() {
  await new Promise((resolve) => {
    const request = indexedDB.deleteDatabase("ProjetoFinancasAuthDB");
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
}

describe("proteção de acesso local", () => {
  beforeEach(async () => {
    await resetAuthDB();
  });

  it("gera salts diferentes para a mesma senha", async () => {
    const a = await createCredentialVerifier("SenhaFicticia123!");
    const b = await createCredentialVerifier("SenhaFicticia123!");
    expect(a.salt).not.toBe(b.salt);
    expect(a.verifier).not.toBe(b.verifier);
  });

  it("valida a credencial correta e rejeita a incorreta", async () => {
    const record = await createCredentialVerifier("SenhaFicticia123!");
    expect(await verifyCredential("SenhaFicticia123!", record)).toBe(true);
    expect(await verifyCredential("OutraSenha", record)).toBe(false);
  });

  it("cria proteção sem armazenar senha em texto puro", async () => {
    await createProtection({ username: "Pessoa Teste", secret: "SenhaFicticia123!", method: "password" });
    const profile = await getAuthProfile();
    expect(profile.username).toBe("Pessoa Teste");
    expect(profile).not.toHaveProperty("password");
    expect(profile).not.toHaveProperty("secret");
    expect(JSON.stringify(profile)).not.toContain("SenhaFicticia123!");
  });

  it("aceita PIN entre 4 e 8 dígitos", async () => {
    await createProtection({ username: "Teste", secret: "482913", method: "pin" });
    expect((await verifyAccess({ username: "Teste", secret: "482913" })).ok).toBe(true);
    expect((await verifyAccess({ username: "Teste", secret: "000000" })).ok).toBe(false);
  });

  it("altera credencial somente com a atual correta", async () => {
    await createProtection({ username: "Teste", secret: "SenhaAntiga123", method: "password" });
    await changeCredential({ currentSecret: "SenhaAntiga123", newSecret: "NovaSenha456", method: "password" });
    expect((await verifyAccess({ username: "Teste", secret: "SenhaAntiga123" })).ok).toBe(false);
    expect((await verifyAccess({ username: "Teste", secret: "NovaSenha456" })).ok).toBe(true);
  });

  it("valida opções de bloqueio automático", async () => {
    await createProtection({ username: "Teste", secret: "SenhaFicticia123", method: "password" });
    const updated = await updateAuthPreferences({ autoLockMinutes: 15, hideSensitiveNotificationsWhenLocked: true });
    expect(updated.autoLockMinutes).toBe(15);
    await expect(updateAuthPreferences({ autoLockMinutes: 7 })).rejects.toThrow();
  });
});