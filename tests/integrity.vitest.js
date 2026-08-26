import { describe, expect, test } from "vitest";
import {
  clearDatabaseData,
  get,
  getAll,
  normalizeRecord,
  put
} from "../js/db.js";
import {
  csvEscape,
  parseLooseNumber,
  parseTransactionAmount
} from "../js/utils.js";
import { validateBackupObject } from "../js/data/backup-service.js";

async function reset() {
  await clearDatabaseData();
}

describe("integridade do banco local", () => {
  test("reset recria carteiras, categorias e settings sem duplicar", async () => {
    await reset();
    await put("transactions", {
      id: "tx-reset-test",
      type: "expense",
      currency: "BRL",
      amount: 10,
      accountId: "account-wallet-brl",
      category: "Mercado",
      description: "Teste",
      date: "2026-08-26",
      status: "cleared"
    });

    await reset();
    await reset();

    const accounts = await getAll("accounts");
    const categories = await getAll("categories");
    const transactions = await getAll("transactions");

    expect(transactions).toHaveLength(0);
    expect(accounts.map((item) => item.id).sort()).toEqual([
      "account-wallet-brl",
      "account-wallet-pyg"
    ]);
    expect(new Set(categories.map((item) => item.name)).size).toBe(categories.length);
    expect((await get("settings", "baseCurrency"))?.value).toBe("PYG");
    expect((await get("settings", "brlToPyg"))?.value).toBe(1300);
  });

  test("conta aceita saldo inicial negativo, transação não", () => {
    expect(() => normalizeRecord("accounts", {
      id: "account-card-test",
      name: "Cartão",
      type: "credit_card",
      currency: "BRL",
      openingBalance: -1000
    })).not.toThrow();

    expect(() => normalizeRecord("transactions", {
      id: "tx-negative",
      type: "expense",
      currency: "BRL",
      amount: -100,
      date: "2026-08-26"
    })).toThrow(/Transação inválida/);
  });
});

describe("parsing de valores assinados", () => {
  test.each([
    ["-100", null, -100],
    ["-100,50", "pt-BR", -100.5],
    ["-1.234,56", "pt-BR", -1234.56],
    ["-1,234.56", "en-US", -1234.56],
    ["R$ -100,00", "pt-BR", -100],
    ["₲ -500.000", "es-PY", -500000]
  ])("preserva sinal de %s", (input, localeHint, expected) => {
    expect(parseLooseNumber(input, { localeHint })).toBe(expected);
  });

  test("parser de transação força valor positivo", () => {
    expect(parseTransactionAmount("-100,50", { localeHint: "pt-BR" })).toBe(100.5);
  });
});

describe("schema de settings", () => {
  test("aceita apenas settings conhecidos e válidos", () => {
    expect(normalizeRecord("settings", { key: "baseCurrency", value: "BRL" })).toEqual({
      key: "baseCurrency",
      value: "BRL"
    });
    expect(normalizeRecord("settings", { key: "brlToPyg", value: 1350 }).value).toBe(1350);
    expect(() => normalizeRecord("settings", { key: "baseCurrency", value: "USD" })).toThrow();
    expect(() => normalizeRecord("settings", { key: "brlToPyg", value: 0 })).toThrow();
    expect(() => normalizeRecord("settings", { key: "apiKey", value: "secret" })).toThrow();
  });

  test("backup com setting desconhecido é rejeitado", () => {
    const result = validateBackupObject({
      schemaVersion: 6,
      stores: {
        transactions: [],
        settings: [{ key: "apiKey", value: "secret" }],
        categories: [{ name: "Mercado" }],
        exchangeRates: [],
        goals: [],
        budgets: [],
        accounts: [],
        schedules: [],
        rules: [],
        reconciliations: []
      }
    });
    expect(result.ok).toBe(false);
  });
});

describe("CSV", () => {
  test.each(["=2+2", "+SUM(A1:A2)", "-10+20", "@cmd"])(
    "neutraliza fórmula %s somente na exportação",
    (value) => {
      expect(csvEscape(value).startsWith("'")).toBe(true);
    }
  );

  test("mantém texto comum", () => {
    expect(csvEscape("Mercado Central")).toBe("Mercado Central");
  });
});
