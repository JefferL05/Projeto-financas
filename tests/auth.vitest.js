import { describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import {
  changeCredential,
  createProtection,
  getAuthProfile,
  updateAuthPreferences,
  verifyAccess
} from "../js/auth/auth-service.js";
import { createCredentialVerifier, verifyCredential } from "../js/auth/crypto-service.js";

describe("proteção de acesso local", () => {
  it("gera salts diferentes e valida a credencial derivada", async () => {
    const a = await createCredentialVerifier("SenhaFicticia123!");
    const b = await createCredentialVerifier("SenhaFicticia123!");
    expect(a.salt).not.toBe(b.salt);
    expect(a.verifier).not.toBe(b.verifier);
    expect(await verifyCredential("SenhaFicticia123!", a)).toBe(true);
    expect(await verifyCredential("OutraSenha", a)).toBe(false);
  });

  it("cria proteção sem texto puro, altera para PIN e valida preferências", async () => {
    await createProtection({ username: "Pessoa Teste", secret: "SenhaFicticia123!", method: "password" });
    let profile = await getAuthProfile();

    expect(profile.username).toBe("Pessoa Teste");
    expect(profile).not.toHaveProperty("password");
    expect(profile).not.toHaveProperty("secret");
    expect(JSON.stringify(profile)).not.toContain("SenhaFicticia123!");
    expect((await verifyAccess({ username: "Pessoa Teste", secret: "SenhaFicticia123!" })).ok).toBe(true);
    expect((await verifyAccess({ username: "Pessoa Teste", secret: "errada" })).ok).toBe(false);

    await changeCredential({ currentSecret: "SenhaFicticia123!", newSecret: "482913", method: "pin" });
    expect((await verifyAccess({ username: "Pessoa Teste", secret: "SenhaFicticia123!" })).ok).toBe(false);
    expect((await verifyAccess({ username: "Pessoa Teste", secret: "482913" })).ok).toBe(true);

    profile = await updateAuthPreferences({ autoLockMinutes: 15, hideSensitiveNotificationsWhenLocked: true });
    expect(profile.autoLockMinutes).toBe(15);
    await expect(updateAuthPreferences({ autoLockMinutes: 7 })).rejects.toThrow();
  });
});