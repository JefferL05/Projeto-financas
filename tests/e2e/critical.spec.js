import { test, expect } from "@playwright/test";

async function waitForApp(page) {
  await page.goto("/index.html");
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
  await expect(page.locator("#recentTransactions")).toContainText(description);
}

test("E2E 1 — cria transação e atualiza dashboard", async ({ page }) => {
  await waitForApp(page);
  await createBRLTransaction(page, { amount: "35,50", description: "Mercado E2E" });
  await expect(page.locator("#brlExpense")).not.toHaveText("- R$ 0,00");
});

test("E2E 2 — importação rápida grava sugestões", async ({ page }) => {
  await waitForApp(page);
  await page.locator("#quickImportBtn").click();
  await page.locator("#smartDefaultCurrency").selectOption("BRL");
  await page.locator("#smartInput").fill("Reais\n-10 gasolina\n-22,50 mercado");
  await expect(page.locator("#smartSuggestions")).toContainText("Combustível");
  await page.locator("#importSmartBtn").click();
  await expect(page.locator("#recentTransactions")).toContainText("gasolina", { ignoreCase: true });
});

test("E2E 3 — cria conta e transfere entre contas BRL", async ({ page }) => {
  await page.goto("/gestao.html");
  await page.locator("#accountName").fill("Poupança E2E");
  await page.locator("#accountType").selectOption("savings");
  await page.locator("#accountCurrency").selectOption("BRL");
  await page.locator("#accountOpening").fill("100");
  await page.locator("#accountForm button[type=submit]").click();
  await expect(page.locator("#accountsList")).toContainText("Poupança E2E");

  await page.locator('[data-tab="transfer"]').click();
  const destinationOption = page.locator("#transferDestination option", { hasText: "Poupança E2E" });
  const destinationId = await destinationOption.getAttribute("value");
  expect(destinationId).toBeTruthy();
  await page.locator("#transferSource").selectOption("account-wallet-brl");
  await page.locator("#transferDestination").selectOption(destinationId);
  await page.locator("#transferSourceAmount").fill("50");
  await page.locator("#transferDestinationAmount").fill("50");
  await page.locator("#transferForm button[type=submit]").click();
  await expect(page.locator("#transferPreview")).toContainText("Confirme a transferência");
  await page.getByRole("button", { name: "Confirmar transferência" }).click();
  await expect(page.locator("#toast")).toContainText("Transferência registrada");
});

test("E2E 4 — cartão aumenta dívida e pagamento por transferência reduz", async ({ page }) => {
  await page.goto("/gestao.html");
  await page.locator("#accountName").fill("Cartão E2E");
  await page.locator("#accountType").selectOption("credit_card");
  await page.locator("#accountCurrency").selectOption("BRL");
  await page.locator("#accountOpening").fill("1000");
  await page.locator("#accountForm button[type=submit]").click();
  const cardOption = page.locator("#reconcileAccount option", { hasText: "Cartão E2E" });
  const cardId = await cardOption.getAttribute("value");
  expect(cardId).toBeTruthy();

  await page.goto("/index.html");
  await page.locator("#newTransactionBtn").click();
  await page.locator("#txCurrency").selectOption("BRL");
  await page.locator("#txAccount").selectOption(cardId);
  await expect(page.locator("#txAccount")).toHaveValue(cardId);
  await page.locator("#txAmount").fill("200");
  await page.locator("#txCategory").selectOption({ label: "Compras" });
  await page.locator("#txDescription").fill("Compra no cartão E2E");
  await page.locator("#saveTransactionBtn").click();
  await expect(page.locator("#transactionDialog")).not.toBeVisible();
  await expect(page.locator("#recentTransactions")).toContainText("Compra no cartão E2E");

  await page.goto("/gestao.html");
  await expect(page.locator("#accountsList")).toContainText("1.200,00");
  await page.locator('[data-tab="transfer"]').click();
  await page.locator("#transferSource").selectOption("account-wallet-brl");
  await page.locator("#transferDestination").selectOption(cardId);
  await page.locator("#transferSourceAmount").fill("300");
  await page.locator("#transferDestinationAmount").fill("300");
  await page.locator("#transferForm button[type=submit]").click();
  await page.getByRole("button", { name: "Confirmar transferência" }).click();
  await expect(page.locator("#toast")).toContainText("Transferência registrada");
  await page.locator('[data-tab="accounts"]').click();
  await expect(page.locator("#accountsList")).toContainText("900,00");
});

test("E2E 5 — exporta, limpa e restaura backup", async ({ page }) => {
  await waitForApp(page);
  await createBRLTransaction(page, { amount: "19,90", description: "Backup E2E" });
  await page.locator('[data-view="data"]').click();

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#exportJsonBtn").click();
  const download = await downloadPromise;
  const backupPath = await download.path();
  expect(backupPath).toBeTruthy();

  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#clearDatabaseBtn").click();
  await expect(page.locator("#dbTransactions")).toHaveText("0");

  page.on("dialog", async (dialog) => {
    await dialog.accept();
  });
  await page.locator("#importJsonInput").setInputFiles(backupPath);
  await expect(page.locator("#toast")).toContainText("Backup restaurado");
  await page.locator('[data-view="transactions"]').click();
  await expect(page.locator("#transactionsList")).toContainText("Backup E2E");
});

test("E2E 6 — app shell continua navegável offline", async ({ page, context }) => {
  await waitForApp(page);
  await page.evaluate(async () => {
    if ("serviceWorker" in navigator) await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#pageTitle")).toHaveText("Dashboard");
  await page.goto("/gestao.html");
  await expect(page.getByRole("heading", { name: "Contas & Planejamento" })).toBeVisible();
  await page.goto("/inteligencia.html#ia");
  await expect(page.locator("#aiModeBadge")).toContainText(/offline|local/i);
  await context.setOffline(false);
});

test("E2E 7 — assistente local responde sem IA externa", async ({ page }) => {
  await page.goto("/inteligencia.html#ia");
  await expect(page.locator("#aiModeBadge")).toContainText(/Análise local|Modo offline/);
  const before = await page.locator("#chatLog > *").count();
  await page.locator("#aiQuestion").fill("Quanto gastei hoje?");
  await page.locator("#askAiBtn").click();
  await expect.poll(async () => page.locator("#chatLog > *").count()).toBeGreaterThan(before);
  await expect(page.locator("#onlineAiToggle")).not.toBeChecked();
});

test("E2E 8 — assistente entende como zerar uma conta PYG negativa", async ({ page }) => {
  await page.goto("/gestao.html");
  await expect(page.locator("#accountsList")).toContainText("Carteira PYG");

  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("ProjetoFinancasDB");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    await new Promise((resolve, reject) => {
      const tx = db.transaction("accounts", "readwrite");
      const store = tx.objectStore("accounts");
      const request = store.get("account-wallet-pyg");
      request.onsuccess = () => {
        store.put({
          ...request.result,
          openingBalance: -99,
          updatedAt: new Date().toISOString()
        });
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  });

  await page.goto("/inteligencia.html#ia");
  await page.locator("#aiQuestion").fill("Como faço pra deixar zero minha conta Guarani : Esta -99");
  await page.locator("#askAiBtn").click();
  await expect(page.locator("#chatLog")).toContainText("zerar");
  await expect(page.locator("#chatLog")).toContainText("99");
  await expect(page.locator("#chatLog")).not.toContainText("Não entendi com segurança");
});