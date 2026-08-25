import { getAll, put } from "../db.js";
import { uid } from "../utils.js";

export const ACCOUNT_TYPES = [
  ["cash", "Dinheiro"],
  ["checking", "Conta corrente"],
  ["savings", "Poupança"],
  ["digital_wallet", "Carteira digital"],
  ["credit_card", "Cartão de crédito"],
  ["investment", "Investimento manual"],
  ["loan", "Empréstimo"],
  ["asset", "Outro ativo"],
  ["liability", "Outra dívida"]
];

export async function listAccounts({ includeArchived = false } = {}) {
  const accounts = await getAll("accounts");
  return accounts
    .filter((account) => includeArchived || !account.archived)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export async function createAccount(input) {
  const now = new Date().toISOString();
  const account = {
    id: uid("account"),
    name: String(input.name || "").trim(),
    type: input.type || "cash",
    currency: input.currency || "BRL",
    openingBalance: Number(input.openingBalance || 0),
    onBudget: input.onBudget !== false,
    includeInNetWorth: input.includeInNetWorth !== false,
    archived: false,
    color: input.color || "#7dd3fc",
    icon: input.icon || "wallet",
    createdAt: now,
    updatedAt: now,
    lastReconciledAt: null
  };
  return put("accounts", account);
}

export async function updateAccount(account, patch) {
  return put("accounts", {
    ...account,
    ...patch,
    id: account.id,
    updatedAt: new Date().toISOString()
  });
}

export async function archiveAccount(account, archived = true) {
  return updateAccount(account, { archived: Boolean(archived) });
}
