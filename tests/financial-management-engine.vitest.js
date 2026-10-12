import { describe, expect, test } from "vitest";
import {
  calculateManagementSnapshot,
  detectPossibleDuplicates,
  simulateDecision,
  buildActionPlan,
  validateActionStatus,
  projectMonthEndBalance
} from "../js/financial-management-engine.js";

const tx = (id, date, type, amount, category = "Mercado", currency = "BRL", description = category) => ({
  id, date, type, amount, category, currency, description, status: "cleared"
});

describe("motor da Gestão Financeira", () => {
  test("calcula receitas, despesas e resultado separadamente por moeda e ignora transferências", () => {
    const snapshot = calculateManagementSnapshot({
      transactions: [
        tx("i1", "2026-10-02", "income", 5000, "Salário", "BRL"),
        tx("e1", "2026-10-03", "expense", 1200, "Mercado", "BRL"),
        tx("t1", "2026-10-04", "transfer", 3000, "Transferência", "BRL"),
        tx("i2", "2026-10-05", "income", 3000000, "Salário", "PYG"),
        tx("e2", "2026-10-06", "expense", 800000, "Mercado", "PYG")
      ],
      month: "2026-10", now: new Date("2026-10-12T12:00:00"), settings: []
    });
    expect(snapshot.currentTotals.BRL.income).toBe(5000);
    expect(snapshot.currentTotals.BRL.expense).toBe(1200);
    expect(snapshot.currentTotals.BRL.net).toBe(3800);
    expect(snapshot.currentTotals.PYG.net).toBe(2200000);
  });

  test("limita mês corrente e comparação ao mesmo dia do mês anterior", () => {
    const snapshot = calculateManagementSnapshot({
      transactions: [
        tx("prev1", "2026-09-12", "expense", 100, "Mercado"),
        tx("prev2", "2026-09-30", "expense", 900, "Mercado"),
        tx("curr1", "2026-10-12", "expense", 150, "Mercado"),
        tx("curr2", "2026-10-28", "expense", 500, "Mercado")
      ],
      month: "2026-10", now: new Date("2026-10-12T12:00:00")
    });
    expect(snapshot.currentPeriod.end).toBe("2026-10-12");
    expect(snapshot.previousPeriod.end).toBe("2026-09-12");
    expect(snapshot.currentTotals.BRL.expense).toBe(150);
    expect(snapshot.previousTotals.BRL.expense).toBe(100);
  });

  test("compara categorias com o mês anterior equivalente", () => {
    const snapshot = calculateManagementSnapshot({
      transactions: [
        tx("old", "2026-09-12", "expense", 100, "Mercado"),
        tx("new", "2026-10-12", "expense", 150, "Mercado")
      ],
      month: "2026-10", now: new Date("2026-10-12T12:00:00")
    });
    expect(snapshot.categoryChanges[0].previousAmount).toBe(100);
    expect(snapshot.categoryChanges[0].changePercent).toBe(50);
    expect(snapshot.alerts.some((alert) => alert.title.includes("Mercado"))).toBe(true);
  });

  test("suspeitas de duplicidade não removem nem alteram lançamentos", () => {
    const transactions = [
      tx("a", "2026-10-01", "expense", 50, "Almoço", "BRL", "Restaurante"),
      tx("b", "2026-10-01", "expense", 50, "Almoço", "BRL", "Restaurante")
    ];
    const before = JSON.stringify(transactions);
    const duplicates = detectPossibleDuplicates(transactions);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].transactionIds).toEqual(["a", "b"]);
    expect(JSON.stringify(transactions)).toBe(before);
    expect(duplicates[0].action).toContain("Nenhum registro será removido");
  });

  test("projeção é explicitamente estimada no mês corrente e não infere renda ausente", () => {
    const snapshot = calculateManagementSnapshot({
      transactions: [tx("expense", "2026-10-01", "expense", 100, "Mercado")],
      month: "2026-10", now: new Date("2026-10-10T12:00:00")
    });
    expect(snapshot.projectedExpense.BRL.estimate).toBe(true);
    expect(snapshot.projectedExpense.BRL.projected).toBeCloseTo(310);
    expect(snapshot.incomeCommitment.BRL.percent).toBeNull();
  });

  test("simulação não altera as transações fornecidas e sinaliza dados insuficientes", () => {
    const transactions = [tx("only", "2026-10-01", "expense", 100)];
    const before = JSON.stringify(transactions);
    const snapshot = calculateManagementSnapshot({ transactions, month: "2026-10", now: new Date("2026-10-10T12:00:00") });
    const result = simulateDecision({ cost: 1000, monthlyPayment: 100, months: 10, currency: "BRL", snapshot, transactions });
    expect(result.enoughData).toBe(false);
    expect(result.recommendation).toContain("Não há informações suficientes");
    expect(JSON.stringify(transactions)).toBe(before);
  });

  test("cenários são calculados e plano de ação evita duplicar a mesma categoria", () => {
    const snapshot = calculateManagementSnapshot({
      transactions: [
        tx("p1", "2026-09-03", "expense", 100, "Mercado"),
        tx("p2", "2026-10-03", "expense", 180, "Mercado")
      ],
      month: "2026-10", now: new Date("2026-10-12T12:00:00")
    });
    const result = simulateDecision({ cost: 300, monthlyPayment: 50, months: 6, currency: "BRL", snapshot, transactions: [
      tx("a", "2026-10-01", "income", 2000), tx("b", "2026-10-02", "expense", 500), tx("c", "2026-10-03", "expense", 400)
    ] });
    expect(result.scenarios).toHaveLength(3);
    const actions = buildActionPlan(snapshot);
    const titles = actions.map((action) => action.title);
    expect(new Set(titles).size).toBe(titles.length);
    expect(validateActionStatus("concluida")).toBe("concluida");
    expect(validateActionStatus("invalid")).toBe("pendente");
  });
});

test("projeta saldo final somente quando as premissas são válidas e separa despesas planejadas", () => {
  const result = projectMonthEndBalance({
    currentBalance: 1000, incomeToDate: 2000, expensesToDate: 500,
    elapsedDays: 10, daysInMonth: 30, plannedExpenses: 100
  });
  expect(result.value).toBeCloseTo(1000 + 2000 / 10 * 20 - (500 / 10 * 30 - 500) - 100);
  expect(result.approximate).toBe(true);
  expect(projectMonthEndBalance({ currentBalance: 1000, incomeToDate: 0, expensesToDate: 0, elapsedDays: 0, daysInMonth: 30 })).toBeNull();
});

test("sugere limites por categoria somente com histórico em dois ou mais meses", () => {
  const snapshot = calculateManagementSnapshot({
    transactions: [
      tx("aug1", "2026-08-03", "expense", 100, "Mercado"),
      tx("sep1", "2026-09-03", "expense", 200, "Mercado")
    ],
    month: "2026-10", now: new Date("2026-10-12T12:00:00")
  });
  expect(snapshot.suggestedBudgets).toHaveLength(1);
  expect(snapshot.suggestedBudgets[0].averageMonthly).toBe(150);
  expect(snapshot.suggestedBudgets[0].suggestedLimit).toBeCloseTo(157.5);
});
