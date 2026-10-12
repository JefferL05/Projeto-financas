import { test, expect } from "@playwright/test";

const E2E_USER = "Teste E2E";
const E2E_PASSWORD = "SenhaE2E123!";

async function unlockIfNeeded(page) {
  const setup = page.locator("#authSetupUser");
  const login = page.locator("#authLoginUser");
  if (await setup.isVisible().catch(() => false)) {
    await setup.fill(E2E_USER);
    await page.locator("#authSetupMethod").selectOption("password");
    await page.locator("#authSetupSecret").fill(E2E_PASSWORD);
    await page.locator("#authSetupConfirm").fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Criar acesso" }).click();
    await expect(page.locator("#authRecoveryCode")).toBeVisible();
    await page.getByRole("button", { name: "Já guardei, continuar" }).click();
    await expect(page.locator(".auth-overlay")).toHaveCount(0);
    return;
  }
  if (await login.isVisible().catch(() => false)) {
    await login.fill(E2E_USER);
    await page.locator("#authLoginSecret").fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.locator(".auth-overlay")).toHaveCount(0);
  }
}

test("Gestão Financeira carrega e navega sem depender de serviços externos", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/gestao-financeira.html");
  await unlockIfNeeded(page);
  await expect(page.getByRole("heading", { name: "Gestão Financeira" })).toBeVisible();
  await expect(page.locator("#fmStatus")).toContainText("Análise concluída");
  await expect(page.locator("#fmIncome")).not.toHaveText("—");
  await page.getByRole("button", { name: "Analisar decisão" }).click();
  await expect(page.getByRole("heading", { name: "Analisar decisão financeira" })).toBeVisible();
  await page.getByRole("button", { name: "Planejamento" }).click();
  await expect(page.locator("#fmFutureExpenseForm")).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("Gestão Financeira permanece utilizável em viewport de 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto("/gestao-financeira.html");
  await unlockIfNeeded(page);
  await expect(page.getByRole("heading", { name: "Gestão Financeira" })).toBeVisible();
  await expect(page.locator("#fmStatus")).toContainText("Análise concluída");
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
});

test("menu principal oferece Gestão Financeira", async ({ page }) => {
  await page.goto("/index.html");
  await unlockIfNeeded(page);
  const link = page.locator('a[href="gestao-financeira.html"]').first();
  await expect(link).toContainText("Gestão Financeira");
  await link.click();
  await expect(page).toHaveURL(/gestao-financeira\.html$/);
  await expect(page.locator("h1")).toHaveText("Gestão Financeira");
});
