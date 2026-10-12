import { test, expect } from "@playwright/test";

test("Gestão Financeira carrega e navega sem depender de serviços externos", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/gestao-financeira.html");
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
  await expect(page.getByRole("heading", { name: "Gestão Financeira" })).toBeVisible();
  await expect(page.locator("#fmStatus")).toContainText("Análise concluída");
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
});
