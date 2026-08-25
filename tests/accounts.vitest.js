import { describe, expect, test } from "vitest";
import { accountBalance, netWorth } from "../js/accounts/account-balance.js";

describe("contas de passivo", () => {
  const card = {
    id: "card-1",
    name: "Cartão",
    type: "credit_card",
    currency: "BRL",
    openingBalance: 300,
    onBudget: false,
    includeInNetWorth: true,
    archived: false
  };

  test("compra no cartão aumenta a dívida", () => {
    const transactions = [
      { id: "tx-1", type: "expense", currency: "BRL", amount: 50, accountId: card.id, date: "2026-08-20" }
    ];

    expect(accountBalance(card, transactions)).toBe(350);
  });

  test("pagamento por transferência reduz a dívida", () => {
    const transactions = [
      {
        id: "tx-2",
        type: "transfer",
        transferRole: "destination",
        currency: "BRL",
        amount: 100,
        accountId: card.id,
        date: "2026-08-21"
      }
    ];

    expect(accountBalance(card, transactions)).toBe(200);
  });

  test("dívida reduz patrimônio líquido", () => {
    const cash = {
      id: "cash-1",
      name: "Conta corrente",
      type: "checking",
      currency: "BRL",
      openingBalance: 1000,
      onBudget: true,
      includeInNetWorth: true,
      archived: false
    };
    const transactions = [
      { id: "tx-3", type: "expense", currency: "BRL", amount: 50, accountId: card.id, date: "2026-08-20" }
    ];

    expect(netWorth([cash, card], transactions, { baseCurrency: "BRL", rate: 1300 })).toBe(650);
  });
});
