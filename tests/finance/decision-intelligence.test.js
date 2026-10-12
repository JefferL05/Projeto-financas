import { describe, expect, it } from "vitest";

function summarizeCategory(transactions, month, currency, category) {
  return transactions.filter((tx) =>
    tx.type === "expense" && tx.currency === currency && tx.category === category && tx.date?.startsWith(month)
  ).reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
}

describe("regras base da inteligência financeira", () => {
  const transactions = [
    { id: "a", type: "expense", currency: "BRL", category: "Mercado", amount: 200, date: "2026-09-05" },
    { id: "b", type: "expense", currency: "BRL", category: "Mercado", amount: 300, date: "2026-09-12" },
    { id: "c", type: "expense", currency: "BRL", category: "Mercado", amount: 600, date: "2026-10-05" },
    { id: "d", type: "expense", currency: "PYG", category: "Mercado", amount: 800000, date: "2026-10-06" },
    { id: "e", type: "transfer", currency: "BRL", category: "Mercado", amount: 900, date: "2026-10-07" }
  ];

  it("compara categorias por moeda sem misturar BRL e PYG", () => {
    expect(summarizeCategory(transactions, "2026-09", "BRL", "Mercado")).toBe(500);
    expect(summarizeCategory(transactions, "2026-10", "BRL", "Mercado")).toBe(600);
    expect(summarizeCategory(transactions, "2026-10", "PYG", "Mercado")).toBe(800000);
  });

  it("não contabiliza transferências como despesas", () => {
    expect(summarizeCategory(transactions, "2026-10", "BRL", "Mercado")).toBe(600);
  });

  it("calcula cenário de redução sem afirmar economia garantida", () => {
    const amount = summarizeCategory(transactions, "2026-10", "BRL", "Mercado");
    expect(amount * 0.1).toBe(60);
  });
});
