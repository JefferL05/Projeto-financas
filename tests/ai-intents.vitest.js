import { describe, expect, test } from "vitest";
import { routeIntent } from "../js/ai/intent-router.js";
import { extractFinancialEntities, normalizeFinancialQuestion } from "../js/ai/entity-extractor.js";
import { buildAccountResponse } from "../js/ai/account-context.js";
import { calculateAmountToTarget, calculateAmountToZero } from "../js/finance/account-targets.js";

const accounts = [
  {
    id: "account-wallet-pyg",
    name: "Carteira PYG",
    type: "cash",
    currency: "PYG",
    openingBalance: -99,
    onBudget: true,
    includeInNetWorth: true,
    archived: false
  },
  {
    id: "account-wallet-brl",
    name: "Carteira BRL",
    type: "cash",
    currency: "BRL",
    openingBalance: 250,
    onBudget: true,
    includeInNetWorth: true,
    archived: false
  }
];

const variants = [
  "Como zero minha conta Guarani?",
  "Quanto falta pra zerar?",
  "Quero sair do negativo na conta Guarani",
  "Quanto preciso depositar na conta Guarani?",
  "Minha conta Guarani está -99, como deixo ela no zero?",
  "Como deixo a carteira PYG zerada?",
  "Quanto falta pra ficar zerado em guarani?"
];

describe("normalização financeira", () => {
  test("normaliza linguagem informal sem perder o sentido", () => {
    expect(normalizeFinancialQuestion("Qto tenho pra gastar? Tô sem grana")).toContain("quanto");
    expect(normalizeFinancialQuestion("Qto tenho pra gastar? Tô sem grana")).toContain("dinheiro");
  });

  test("preserva valor negativo como entidade", () => {
    const entities = extractFinancialEntities("Minha conta Guarani está -99", { accounts });
    expect(entities.currency).toBe("PYG");
    expect(entities.amount).toBe(-99);
    expect(entities.accountId).toBe("account-wallet-pyg");
  });

  test("entende milhão e mil em linguagem natural", () => {
    expect(extractFinancialEntities("quero chegar em 1 milhão", { accounts }).amount).toBe(1_000_000);
    expect(extractFinancialEntities("estou devendo 500 mil", { accounts }).amount).toBe(500_000);
  });
});

describe("intenção account_zero_balance", () => {
  for (const phrase of variants) {
    test(`reconhece: ${phrase}`, () => {
      const route = routeIntent(phrase, { accounts });
      expect(route.intent).toBe("account_zero_balance");
      expect(route.confidence).toBeGreaterThanOrEqual(0.55);
    });
  }

  test("regressão da pergunta da interface", () => {
    const route = routeIntent("Como faço pra deixar zero minha conta Guarani : Esta -99", { accounts });
    expect(route.intent).toBe("account_zero_balance");
    expect(route.filters.currency).toBe("PYG");
    expect(route.entities.amount).toBe(-99);
    expect(route.entities.accountId).toBe("account-wallet-pyg");
  });

  test("não confunde gasto comum com zerar conta", () => {
    const route = routeIntent("Quanto gastei no mercado este mês?", { accounts, categories: ["Mercado"] });
    expect(route.intent).not.toBe("account_zero_balance");
  });
});

describe("cálculo determinístico de saldo", () => {
  test("saldo negativo exige depósito", () => {
    expect(calculateAmountToZero(-99)).toEqual({ direction: "deposit", amount: 99, targetBalance: 0 });
  });

  test("saldo positivo exige retirada para zerar", () => {
    expect(calculateAmountToZero(250)).toEqual({ direction: "withdraw", amount: 250, targetBalance: 0 });
  });

  test("calcula diferença até alvo", () => {
    expect(calculateAmountToTarget(450000, 1000000)).toEqual({ direction: "deposit", amount: 550000, targetBalance: 1000000 });
  });
});

describe("respostas objetivas de conta", () => {
  test("usa saldo real da conta e informa quanto adicionar", () => {
    const route = routeIntent("Como faço pra deixar zero minha conta Guarani : Esta -99", { accounts });
    const response = buildAccountResponse(route, {
      accounts,
      transactions: [],
      baseCurrency: "PYG",
      rate: 1300
    });

    expect(response.metrics.find((item) => item.label === "Saldo atual")?.value).toBe(-99);
    expect(response.metrics.find((item) => item.label === "Valor para zerar")?.value).toBe(99);
    expect(response.summary).toContain("zerar");
    expect(response.summary).toContain("99");
    expect(response.clarification).toBeNull();
  });

  test("saldo informado pelo usuário não substitui saldo registrado", () => {
    const route = routeIntent("Minha conta Guarani está -50, quanto falta pra zerar?", { accounts });
    const response = buildAccountResponse(route, {
      accounts,
      transactions: [],
      baseCurrency: "PYG",
      rate: 1300
    });
    expect(response.summary).toContain("99");
    expect(response.observations.join(" ")).toContain("mencionou");
  });

  test("pergunta de saldo em BRL resolve conta compatível", () => {
    const route = routeIntent("Quanto tenho em reais?", { accounts });
    expect(route.intent).toBe("account_balance");
    const response = buildAccountResponse(route, {
      accounts,
      transactions: [],
      baseCurrency: "PYG",
      rate: 1300
    });
    expect(response.summary).toContain("250");
    expect(response.summary).toContain("Carteira BRL");
  });

  test("contas PYG ambíguas pedem esclarecimento", () => {
    const moreAccounts = [
      ...accounts,
      { ...accounts[0], id: "poupanca-pyg", name: "Poupança PYG", openingBalance: 1000 }
    ];
    const route = routeIntent("Quanto falta pra zerar minha conta Guarani?", { accounts: moreAccounts });
    const response = buildAccountResponse(route, {
      accounts: moreAccounts,
      transactions: [],
      baseCurrency: "PYG",
      rate: 1300
    });
    expect(response.clarification).toContain("mais de uma conta");
  });

  test("intenção de alvo usa valor abreviado", () => {
    const route = routeIntent("Quanto falta para chegar em 1 milhão na Carteira PYG?", { accounts });
    expect(route.intent).toBe("account_target");
    expect(route.entities.targetAmount).toBe(1_000_000);
  });
});
