import { getAll, put, runAtomic } from "../db.js";
import { accountClearedBalance } from "./account-balance.js";
import { uid } from "../utils.js";

export function reconciliationDifference(account, transactions, statementBalance) {
  const cleared = accountClearedBalance(account, transactions);
  return Number(statementBalance) - cleared;
}

export async function reconcileAccount({ account, statementBalance, transactionIds = [], date, createAdjustment = false }) {
  const allTransactions = await getAll("transactions");
  const accountTransactions = allTransactions.filter((item) => item.accountId === account.id);
  const selected = new Set(transactionIds);
  const timestamp = new Date().toISOString();

  const staged = accountTransactions.map((transaction) => {
    if (!selected.has(transaction.id)) return transaction;
    return {
      ...transaction,
      status: "reconciled",
      reconciledAt: timestamp,
      clearedAt: transaction.clearedAt || timestamp,
      updatedAt: timestamp
    };
  });

  const difference = Number(statementBalance) - accountClearedBalance(account, staged);
  if (Math.abs(difference) > 0.000001 && !createAdjustment) {
    return {
      ok: false,
      difference,
      message: "A diferença precisa ser zero ou deve ser criado um ajuste identificado."
    };
  }

  let adjustment = null;
  if (Math.abs(difference) > 0.000001) {
    adjustment = {
      id: uid("tx"),
      type: difference >= 0 ? "income" : "expense",
      currency: account.currency,
      amount: Math.abs(difference),
      accountId: account.id,
      category: "Ajuste de conciliação",
      description: "Ajuste de conciliação manual",
      date,
      tags: ["conciliacao"],
      status: "reconciled",
      clearedAt: timestamp,
      reconciledAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    };
  }

  const reconciliation = {
    id: uid("reconciliation"),
    accountId: account.id,
    date,
    statementBalance: Number(statementBalance),
    difference: 0,
    transactionIds: [...selected],
    adjustmentTransactionId: adjustment?.id || null,
    createdAt: timestamp
  };

  const updatedAccount = {
    ...account,
    lastReconciledAt: timestamp,
    updatedAt: timestamp
  };

  await runAtomic(["transactions", "accounts", "reconciliations"], "readwrite", (stores) => {
    staged.filter((transaction) => selected.has(transaction.id)).forEach((transaction) => stores.transactions.put(transaction));
    if (adjustment) stores.transactions.put(adjustment);
    stores.accounts.put(updatedAccount);
    stores.reconciliations.put(reconciliation);
  });

  return { ok: true, reconciliation, adjustment, account: updatedAccount };
}
