import { test, expect } from "@playwright/test";

const USER = "Usuário E2E";
const PASSWORD = "SenhaSeguraE2E123!";

async function createAccess(page, path = "/index.html") {
  await page.goto(path);
  await expect(page.locator("#authSetupUser")).toBeVisible();
  await page.locator("#authSetupUser").fill(USER);
  await page.locator("#authSetupMethod").selectOption("password");
  await page.locator("#authSetupSecret").fill(PASSWORD);
  await page.locator("#authSetupConfirm").fill(PASSWORD);
  await page.getByRole("button", { name: "Criar acesso" }).click();
  await expect(page.locator(".auth-overlay")).toHaveCount(0);
}

async function forceLock(page) {
  await page.evaluate(() => sessionStorage.clear());
}

test("AUTH E2E 1 — primeiro acesso cria proteção antes do dashboard", async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.locator("#authSetupUser")).toBeVisible();
  await expect(page.locator(".app-shell")).toBeHidden();
  await createAccess(page);
  await expect(page.locator("#pageTitle")).toHaveText("Dashboard");
});

test("AUTH E2E 2 — sessão encerrada exige login novamente", async ({ page }) => {
  await createAccess(page);
  await forceLock(page);
  await page.reload();
  await expect(page.locator("#authLoginUser")).toBeVisible();
  await expect(page.locator(".app-shell")).toBeHidden();
  await page.locator("#authLoginSecret").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.locator("#pageTitle")).toHaveText("Dashboard");
});

test("AUTH E2E 3 — senha incorreta mantém aplicativo bloqueado", async ({ page }) => {
  await createAccess(page);
  await forceLock(page);
  await page.reload();
  await page.locator("#authLoginSecret").fill("SenhaIncorreta");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.locator(".auth-error")).toContainText("incorreto");
  await expect(page.locator(".auth-overlay")).toBeVisible();
  await expect(page.locator(".app-shell")).toBeHidden();
});

test("AUTH E2E 4 — acesso direto ao assistente também exige autenticação", async ({ page }) => {
  await createAccess(page);
  await forceLock(page);
  await page.goto("/inteligencia.html#ia");
  await expect(page.locator("#authLoginUser")).toBeVisible();
  await expect(page.locator(".intel-shell")).toBeHidden();
  await page.locator("#authLoginSecret").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.locator("#aiModeBadge")).toContainText(/Análise local|Modo offline/);
});

test("AUTH E2E 5 — bloquear agora oculta os dados imediatamente", async ({ page }) => {
  await createAccess(page);
  await page.locator('[data-view="settings"]').click();
  await expect(page.locator("#authSecurityCard")).toBeVisible();
  await page.getByRole("button", { name: "Bloquear agora" }).click();
  await expect(page.locator("#authLoginUser")).toBeVisible();
  await expect(page.locator(".app-shell")).toBeHidden();
});

test("AUTH E2E 6 — login local funciona offline após app shell instalado", async ({ page, context }) => {
  await createAccess(page);
  await page.evaluate(async () => {
    if ("serviceWorker" in navigator) await navigator.serviceWorker.ready;
  });
  await forceLock(page);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#authLoginUser")).toBeVisible();
  await page.locator("#authLoginSecret").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.locator("#pageTitle")).toHaveText("Dashboard");
  await context.setOffline(false);
});