import { describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import {
  changeCredential,
  createProtection,
  getAuthProfile,
  regenerateRecoveryCode,
  resetCredentialWithRecovery,
  updateAuthPreferences,
  verifyAccess,
  verifyRecoveryCode
} from "../js/auth/auth-service.js";
import {
  createCredentialVerifier,
  generateRecoveryCode,
  normalizeRecoveryCode,
  verifyCredential
} from "../js/auth/crypto-service.js";

describe("proteção de acesso local", () => {
  it("gera salts diferentes e valida a credencial derivada", async () => {
    const a = await createCredentialVerifier("SenhaFicticia123!");
    const b = await createCredentialVerifier("SenhaFicticia123!");
    expect(a.salt).not.toBe(b.salt);
    expect(a.verifier).not.toBe(b.verifier);
    expect(await verifyCredential("SenhaFicticia123!", a)).toBe(true);
    expect(await verifyCredential("OutraSenha", a)).toBe(false);
  });

  it("gera código de recuperação forte e normalizável", () => {
    const a = generateRecoveryCode();
    const b = generateRecoveryCode();
    expect(a).toMatch(/^PF-(?:[A-Z2-9]{4}-){4}[A-Z2-9]{4}$/);
    expect(a).not.toBe(b);
    expect(normalizeRecoveryCode(a.toLowerCase().replaceAll("-", " "))).toBe(a.slice(3).replaceAll("-", ""));
  });

  it("cria proteção sem texto puro, altera credencial e recupera acesso com código", async () => {
    await createProtection({ username: "Pessoa Teste", secret: "SenhaFicticia123!", method: "password" });
    let profile = await getAuthProfile();

    expect(profile.username).toBe("Pessoa Teste");
    expect(profile).not.toHaveProperty("password");
    expect(profile).not.toHaveProperty("secret");
    expect(JSON.stringify(profile)).not.toContain("SenhaFicticia123!");
    expect(profile.recoveryVerifier).toBeTruthy();
    expect(profile).not.toHaveProperty("recoveryCode");
    expect((await verifyAccess({ username: "Pessoa Teste", secret: "SenhaFicticia123!" })).ok).toBe(true);
    expect((await verifyAccess({ username: "Pessoa Teste", secret: "errada" })).ok).toBe(false);

    await changeCredential({ currentSecret: "SenhaFicticia123!", newSecret: "482913", method: "pin" });
    expect((await verifyAccess({ username: "Pessoa Teste", secret: "SenhaFicticia123!" })).ok).toBe(false);
    expect((await verifyAccess({ username: "Pessoa Teste", secret: "482913" })).ok).toBe(true);

    profile = await updateAuthPreferences({ autoLockMinutes: 15, hideSensitiveNotificationsWhenLocked: true });
    expect(profile.autoLockMinutes).toBe(15);
    await expect(updateAuthPreferences({ autoLockMinutes: 7 })).rejects.toThrow();

    const generated = await regenerateRecoveryCode("482913");
    expect(generated.recoveryCode).toMatch(/^PF-/);
    expect(JSON.stringify(generated.profile)).not.toContain(generated.recoveryCode);
    expect((await verifyRecoveryCode({ username: "Pessoa Teste", recoveryCode: generated.recoveryCode })).ok).toBe(true);
    expect((await verifyRecoveryCode({ username: "Pessoa Teste", recoveryCode: "PF-AAAA-BBBB-CCCC-DDDD-EEEE" })).ok).toBe(false);

    const recovered = await resetCredentialWithRecovery({
      username: "Pessoa Teste",
      recoveryCode: generated.recoveryCode,
      newSecret: "NovaSenhaFicticia456!",
      method: "password"
    });

    expect((await verifyAccess({ username: "Pessoa Teste", secret: "482913" })).ok).toBe(false);
    expect((await verifyAccess({ username: "Pessoa Teste", secret: "NovaSenhaFicticia456!" })).ok).toBe(true);
    expect((await verifyRecoveryCode({ username: "Pessoa Teste", recoveryCode: generated.recoveryCode })).ok).toBe(false);
    expect((await verifyRecoveryCode({ username: "Pessoa Teste", recoveryCode: recovered.recoveryCode })).ok).toBe(true);
  });
});