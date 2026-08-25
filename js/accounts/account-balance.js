import { convertAmount, convertTransaction } from "../finance/exchange.js";

const LIABILITY_TYPES = new Set(["credit_card", "loan", "liability"]);
const LIQUID_TYPES = new Set(["cash", "checking", "savings", "digital_wallet"]);

export function isLiabilityAccount(account) {
  return LIABILITY_TYPES.has(account?.type);
}

export function isLiquidAccount(account) {
  return LIQUID_TYPES.has(account?.type);
}

export function transactionImpact(transaction, accountId) {
  if (!transaction || transaction.accountId !== accountId) return 0;
  const amount = Number(transaction.amount) || 0;

  if (transaction.type === "income") return amount;
  if (transaction.type === "expense") return -amount;

  if (transaction.type === "transfer") {
    if (transaction.transferRole === "destination") return amount;
    return -amount;
  }

  return 0;
}

export function accountBalance(account, transactions = []) {
  const opening = Number(account?.openingBalance) || 0;
  return transactions.reduce((balance, transaction) => balance + transactionImpact(transaction, account?.id), opening);
}

export function accountClearedBalance(account, transactions = []) {
  const opening = Number(account?.openingBalance) || 0;
  return transactions
    .filter((transaction) => transaction.status === "cleared" || transaction.status === "reconciled")
    .reduce((balance, transaction) => balance + transactionImpact(transaction, account?.id), opening);
}

export function accountReconciledBalance(account, transactions = []) {
  const opening = Number(account?.openingBalance) || 0;
  return transactions
    .filter((transaction) => transaction.status === "reconciled")
    .reduce((balance, transaction) => balance + transactionImpact(transaction, account?.id), opening);
}

export function accountSummary(account, transactions = [], { baseCurrency = "PYG", rate = 1300 } = {}) {
  const balance = accountBalance(account, transactions);
  const clearedBalance = accountClearedBalance(account, transactions);
  const reconciledBalance = accountReconciledBalance(account, transactions);
  const sign = isLiabilityAccount(account) ? -1 : 1;

  return {
    account,
    balance,
    clearedBalance,
    reconciledBalance,
    netWorthValue: sign * convertAmount(balance, account.currency, baseCurrency, rate),
    availableValue: account.onBudget && isLiquidAccount(account)
      ? convertAmount(balance, account.currency, baseCurrency, rate)
      : 0
  };
}

export function netWorth(accounts = [], transactions = [], { baseCurrency = "PYG", rate = 1300 } = {}) {
  return accounts
    .filter((account) => !account.archived && account.includeInNetWorth !== false)
    .reduce((sum, account) => sum + accountSummary(account, transactions, { baseCurrency, rate }).netWorthValue, 0);
}

export function availableFunds(accounts = [], transactions = [], { baseCurrency = "PYG", rate = 1300 } = {}) {
  return accounts
    .filter((account) => !account.archived)
    .reduce((sum, account) => sum + accountSummary(account, transactions, { baseCurrency, rate }).availableValue, 0);
}

export function accountBalanceInBase(account, transactions, { baseCurrency = "PYG", rates = [], rate = 1300 } = {}) {
  const opening = convertAmount(Number(account.openingBalance) || 0, account.currency, baseCurrency, rate);
  return transactions.reduce((balance, transaction) => {
    if (transaction.accountId !== account.id) return balance;
    const converted = convertTransaction(transaction, baseCurrency, rates, rate).amount;
    const direction = transaction.type === "income" || transaction.transferRole === "destination" ? 1 : -1;
    return balance + converted * direction;
  }, opening);
}
