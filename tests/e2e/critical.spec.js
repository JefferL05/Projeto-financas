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

async function openProtected(page, path) {
  await page.goto(path);
  await unlockIfNeeded(page);
}

async function waitForApp(page) {
  await openProtected(page, "/index.html");
  await expect(page.locator("#pageTitle")).toHaveText("Dashboard");
  await page.waitForFunction(() => indexedDB.databases ? indexedDB.databases().then((dbs) => dbs.some((db) => db.name === "ProjetoFinancasDB")) : true);
}

async function createBRLTransaction(page, { amount = "25,00", description = "Teste E2E", category = "Mercado" } = {}) {
  await page.locator("#newTransactionBtn").click();
  await expect(page.locator("#transactionDialog")).toBeVisible();
  await page.locator("#txCurrency").selectOption("BRL");
  await page.locator("#txAccount").selectOption("account-wallet-brl");
  await page.locator("#txAmount").fill(amount);
  await page.locator("#txCategory").selectOption({ label: category });
  await page.locator("#txDescription").fill(description);
  await page.locator("#saveTransactionBtn").click();
  await expect(page.locator("#transactionDialog")).not.toBeVisible();
}

test("E2E 1 — criar transação atualiza o dashboard", async ({ page }) => {
  await waitForApp(page);
  await createBRLTransaction(page, { amount: "45,00", description: "Mercado E2E" });
  await expect(page.locator("#brlExpense")).toContainText("45,00");
});

test("E2E 2 — importação rápida cria lançamentos", async ({ page }) => {
  await waitForApp(page);
  await page.locator("#quickImportBtn").click();
  await page.locator("#smartDefaultCurrency").selectOption("PYG");
  await page.locator("#smartInput").fill("-83.467 mercado\n-18.000 Maxi");
  await expect(page.locator("#smartSuggestions")).toContainText("83.467");
  await page.locator("#importSmartBtn").click();
  await expect(page.locator("#smartImportDialog")).not.toBeVisible();
  await expect(page.locator("#pygExpense")).toContainText("101.467");
});

test("E2E 3 — criar conta e fazer transferência", async ({ page }) => {
  await openProtected(page, "/gestao.html#accounts");
  await page.locator("#accountName").fill("Poupança Teste");
  await page.locator("#accountType").selectOption("savings");
  await page.locator("#accountCurrency").selectOption("BRL");
  await page.locator("#accountOpening").fill("0");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.locator("#accountsList")).toContainText("Poupança Teste");

  await page.locator('[data-tab="transfer"]').click();
  await page.locator("#transferSource").selectOption("account-wallet-brl");
  const target = page.locator("#transferDestination option").filter({ hasText: "Poupança Teste" }).first();
  const targetValue = await target.getAttribute("value");
  await page.locator("#transferDestination").selectOption(targetValue);
  await page.locator("#transferSourceAmount").fill("100");
  await page.locator("#transferDestinationAmount").fill("100");
  await page.locator("#transferForm button[type='submit']").click();
  await page.getByRole("button", { name: "Confirmar transferência" }).click();
  await expect(page.locator("#transferPreview")).toBeHidden();
});

test("E2E 4 — cartão aumenta dívida e pagamento reduz", async ({ page }) => {
  await openProtected(page, "/gestao.html#accounts");
  await page.locator("#accountName").fill("Cartão Teste");
  await page.locator("#accountType").selectOption("credit_card");
  await page.locator("#accountCurrency").selectOption("BRL");
  await page.locator("#accountOpening").fill("1000");
  await page.locator("#accountForm button[type='submit']").click();
  await expect(page.locator("#accountsList")).toContainText("Cartão Teste");

  await openProtected(page, "/index.html");
  await page.locator("#newTransactionBtn").click();
  await page.locator("[data-tx-type='expense']").click();
  await page.locator("#txCurrency").selectOption("BRL");
  const cardOption = page.locator("#txAccount option").filter({ hasText: "Cartão Teste" }).first();
  const cardId = await cardOption.getAttribute("value");
  await page.locator("#txAccount").selectOption(cardId);
  await page.locator("#txAmount").fill("200");
  await page.locator("#txCategory").selectOption({ label: "Compras" });
  await page.locator("#saveTransactionBtn").click();
  await expect(page.locator("#transactionDialog")).not.toBeVisible();

  await openProtected(page, "/gestao.html#accounts");
  await expect(page.locator("#accountsList")).toContainText("1.200,00");

  await page.locator('[data-tab="transfer"]').click();
  await page.locator("#transferSource").selectOption("account-wallet-brl");
  await page.locator("#transferDestination").selectOption(cardId);
  await page.locator("#transferSourceAmount").fill("300");
  await page.locator("#transferDestinationAmount").fill("300");
  await page.locator("#transferForm button[type='submit']").click();
  await page.getByRole("button", { name: "Confirmar transferência" }).click();
  await page.locator('[data-tab="accounts"]').click();
  await expect(page.locator("#accountsList")).toContainText("900,00");
});

test("E2E 5 — backup, reset e restore", async ({ page }) => {
  await waitForApp(page);
  await createBRLTransaction(page, { amount: "30,00", description: "Backup E2E" });
  await page.locator('.nav-link[data-view="data"]:visible').first().click();
  const download = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#exportJsonBtn").click()
  ]).then(([item]) => item);
  const backupPath = await download.path();

  page.on("dialog", (dialog) => dialog.accept());
  await page.locator("#clearDatabaseBtn").click();
  await expect(page.locator("#dbTransactions")).toHaveText("0");

  await page.locator("#importJsonInput").setInputFiles(backupPath);
  await expect(page.locator("#dbTransactions")).not.toHaveText("0");
  await expect(page.locator("#dbTransactions")).not.toHaveText("0");
});

test("E2E 6 — offline mantém recursos locais", async ({ page, context }) => {
  await waitForApp(page);
  await page.evaluate(async () => {
    if ("serviceWorker" in navigator) await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await page.reload();
  await unlockIfNeeded(page);
  await expect(page.locator("#pageTitle")).toHaveText("Dashboard");
  await openProtected(page, "/gestao.html#accounts");
  await expect(page.locator("#accountsList")).toBeVisible();
  await openProtected(page, "/inteligencia.html#ia");
  await expect(page.locator("#aiModeBadge")).toContainText(/Análise local|Modo offline/);
  await context.setOffline(false);
});

test("E2E 7 — assistente local responde consulta", async ({ page }) => {
  await openProtected(page, "/inteligencia.html#ia");
  await page.locator("#aiQuestion").fill("Quanto gastei hoje?");
  await page.locator("#askAiBtn").click();
  await expect(page.locator("#chatLog")).toContainText(/gasto|despesa|hoje/i);
});

test("E2E 8 — assistente entende como zerar conta PYG negativa", async ({ page }) => {
  await openProtected(page, "/gestao.html#accounts");
  await page.locator("#accountName").fill("Carteira PYG Teste Negativa");
  await page.locator("#accountType").selectOption("digital_wallet");
  await page.locator("#accountCurrency").selectOption("PYG");
  await page.locator("#accountOpening").fill("-99");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.locator("#accountsList")).toContainText("Carteira PYG Teste Negativa");

  await openProtected(page, "/inteligencia.html#ia");
  await page.locator("#aiQuestion").fill("Como faço pra deixar zero minha conta Carteira PYG Teste Negativa que está -99?");
  await page.locator("#askAiBtn").click();
  await expect(page.locator("#chatLog")).toContainText(/zerar|adicionar/i);
  await expect(page.locator("#chatLog")).not.toContainText("Não entendi com segurança");
});

test("E2E — Cancelar e X fecham o modal sem salvar", async ({ page }) => {
  await waitForApp(page);
  await page.locator("#newTransactionBtn").click();
  await expect(page.locator("#transactionDialog")).toBeVisible();
  await page.locator('#transactionDialog .dialog-head button[aria-label="Fechar"]').click();
  await expect(page.locator("#transactionDialog")).not.toBeVisible();

  await page.locator("#newTransactionBtn").click();
  await expect(page.locator("#transactionDialog")).toBeVisible();
  await page.locator("#transactionDialog .dialog-actions button").filter({ hasText: "Cancelar" }).click();
  await expect(page.locator("#transactionDialog")).not.toBeVisible();
});

test("E2E — tema persiste e rodapé informativo fica fixo em viewport móvel", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await waitForApp(page);
  const themeButton = page.locator("#themeToggleBtn");
  await themeButton.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(themeButton).toContainText("Tema escuro");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("pf-theme"))).toBe("light");

  const footer = page.locator(".app-info-footer");
  await expect(footer).toBeVisible();
  await expect(footer).toContainText("Faça backups regularmente");
  const footerStyle = await footer.evaluate((element) => ({
    position: getComputedStyle(element).position,
    bottom: getComputedStyle(element).bottom,
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth
  }));
  expect(footerStyle.position).toBe("fixed");
  expect(Number.parseFloat(footerStyle.bottom)).toBeGreaterThan(0);
  expect(footerStyle.documentWidth).toBeLessThanOrEqual(footerStyle.viewportWidth);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
