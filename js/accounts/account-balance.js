import { convertAmount, convertTransaction } from "../finance/exchange.js";

const LIABILITY_TYPES = new Set(["credit_card", "loan", "liability"]);
const LIQUID_TYPES = new Set(["cash", "checking", "savings", "digital_wallet"]);

export function isLiabilityAccount(account) {
  return LIABILITY_TYPES.has(account?.type);
}

export function isLiquidAccount(account) {
  return LIQUID_TYPES.has(account?.type);
}

function movementDirection(transaction, account) {
  const liability = isLiabilityAccount(account);

  if (transaction.type === "income") return liability ? -1 : 1;
  if (transaction.type === "expense") return liability ? 1 : -1;

  if (transaction.type === "transfer") {
    if (transaction.transferRole === "destination") return liability ? -1 : 1;
    if (transaction.transferRole === "source") return liability ? 1 : -1;
  }

  return 0;
}

export function transactionImpact(transaction, accountOrId) {
  if (!transaction) return 0;

  const account = typeof accountOrId === "string"
    ? { id: accountOrId, type: "asset" }
    : accountOrId;

  if (!account || transaction.accountId !== account.id) return 0;
  return (Number(transaction.amount) || 0) * movementDirection(transaction, account);
}

function balanceForStatuses(account, transactions, allowedStatuses = null) {
  const opening = Number(account?.openingBalance) || 0;

  return transactions.reduce((balance, transaction) => {
    if (allowedStatuses && !allowedStatuses.has(transaction.status)) return balance;
    return balance + transactionImpact(transaction, account);
  }, opening);
}

export function accountBalance(account, transactions = []) {
  return balanceForStatuses(account, transactions);
}

export function accountClearedBalance(account, transactions = []) {
  return balanceForStatuses(account, transactions, new Set(["cleared", "reconciled"]));
}

export function accountReconciledBalance(account, transactions = []) {
  return balanceForStatuses(account, transactions, new Set(["reconciled"]));
}

export function accountSummary(account, transactions = [], { baseCurrency = "PYG", rate = 1300 } = {}) {
  const balance = accountBalance(account, transactions);
  const clearedBalance = accountClearedBalance(account, transactions);
  const reconciledBalance = accountReconciledBalance(account, transactions);
  const netWorthSign = isLiabilityAccount(account) ? -1 : 1;

  return {
    account,
    balance,
    clearedBalance,
    reconciledBalance,
    netWorthValue: netWorthSign * convertAmount(balance, account.currency, baseCurrency, rate),
    availableValue: account.onBudget && isLiquidAccount(account)
      ? convertAmount(balance, account.currency, baseCurrency, rate)
      : 0
  };
}

export function netWorth(accounts = [], transactions = [], { baseCurrency = "PYG", rate = 1300 } = {}) {
  return accounts
    .filter((account) => !account.archived && account.includeInNetWorth !== false)
    .reduce(
      (sum, account) => sum + accountSummary(account, transactions, { baseCurrency, rate }).netWorthValue,
      0
    );
}

export function availableFunds(accounts = [], transactions = [], { baseCurrency = "PYG", rate = 1300 } = {}) {
  return accounts
    .filter((account) => !account.archived)
    .reduce(
      (sum, account) => sum + accountSummary(account, transactions, { baseCurrency, rate }).availableValue,
      0
    );
}

export function accountBalanceInBase(account, transactions, { baseCurrency = "PYG", rates = [], rate = 1300 } = {}) {
  const opening = convertAmount(Number(account.openingBalance) || 0, account.currency, baseCurrency, rate);

  return transactions.reduce((balance, transaction) => {
    if (transaction.accountId !== account.id) return balance;

    const converted = convertTransaction(transaction, baseCurrency, rates, rate).amount;
    return balance + converted * movementDirection(transaction, account);
  }, opening);
}
