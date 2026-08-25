import { getAll, normalizeRecord, runAtomic } from "../db.js";
import { uid } from "../utils.js";

function nowISO() {
  return new Date().toISOString();
}

function validateTransferInput({ sourceAccount, destinationAccount, sourceAmount, destinationAmount, exchangeRate }) {
  if (!sourceAccount || !destinationAccount || sourceAccount.id === destinationAccount.id) {
    throw new TypeError("Contas de origem e destino devem ser diferentes.");
  }
  if (!(Number(sourceAmount) > 0) || !(Number(destinationAmount) > 0)) {
    throw new TypeError("Valores da transferência devem ser positivos.");
  }
  if (sourceAccount.currency === destinationAccount.currency && Number(sourceAmount) !== Number(destinationAmount)) {
    throw new TypeError("Transferência na mesma moeda exige valores iguais.");
  }
  if (sourceAccount.currency !== destinationAccount.currency && !(Number(exchangeRate) > 0)) {
    throw new TypeError("Transferência entre moedas exige cotação válida.");
  }
}

export function buildTransfer({
  sourceAccount,
  destinationAccount,
  sourceAmount,
  destinationAmount,
  exchangeRate = null,
  date,
  description = "Transferência",
  status = "cleared"
}) {
  validateTransferInput({ sourceAccount, destinationAccount, sourceAmount, destinationAmount, exchangeRate });

  const transferId = uid("transfer");
  const timestamp = nowISO();
  const source = normalizeRecord("transactions", {
    id: uid("tx"),
    type: "transfer",
    currency: sourceAccount.currency,
    amount: Number(sourceAmount),
    accountId: sourceAccount.id,
    category: "Transferência",
    description,
    date,
    tags: [],
    status,
    transferId,
    transferRole: "source",
    counterpartyAccountId: destinationAccount.id,
    exchangeRateSnapshot: sourceAccount.currency === "BRL" ? Number(exchangeRate) || null : null,
    createdAt: timestamp,
    updatedAt: timestamp
  });

  const destination = normalizeRecord("transactions", {
    id: uid("tx"),
    type: "transfer",
    currency: destinationAccount.currency,
    amount: Number(destinationAmount),
    accountId: destinationAccount.id,
    category: "Transferência",
    description,
    date,
    tags: [],
    status,
    transferId,
    transferRole: "destination",
    counterpartyAccountId: sourceAccount.id,
    exchangeRateSnapshot: destinationAccount.currency === "BRL" ? Number(exchangeRate) || null : null,
    createdAt: timestamp,
    updatedAt: timestamp
  });

  return { transferId, source, destination };
}

export async function createTransfer(input) {
  const transfer = buildTransfer(input);
  await runAtomic(["transactions"], "readwrite", (stores) => {
    stores.transactions.put(transfer.source);
    stores.transactions.put(transfer.destination);
  });
  return transfer;
}

export async function getTransferParts(transferId) {
  const all = await getAll("transactions");
  return all.filter((transaction) => transaction.transferId === transferId);
}

export async function deleteTransfer(transferId) {
  const parts = await getTransferParts(transferId);
  if (parts.length !== 2) throw new Error("Transferência incompleta: operação cancelada.");

  await runAtomic(["transactions"], "readwrite", (stores) => {
    parts.forEach((part) => stores.transactions.delete(part.id));
  });
  return parts;
}

export async function updateTransfer(transferId, patch) {
  const parts = await getTransferParts(transferId);
  if (parts.length !== 2) throw new Error("Transferência incompleta: operação cancelada.");

  const source = parts.find((item) => item.transferRole === "source");
  const destination = parts.find((item) => item.transferRole === "destination");
  if (!source || !destination) throw new Error("Papéis da transferência inválidos.");

  const timestamp = nowISO();
  const updatedSource = normalizeRecord("transactions", {
    ...source,
    amount: patch.sourceAmount ?? source.amount,
    date: patch.date ?? source.date,
    description: patch.description ?? source.description,
    exchangeRateSnapshot: patch.exchangeRate ?? source.exchangeRateSnapshot,
    updatedAt: timestamp
  });
  const updatedDestination = normalizeRecord("transactions", {
    ...destination,
    amount: patch.destinationAmount ?? destination.amount,
    date: patch.date ?? destination.date,
    description: patch.description ?? destination.description,
    exchangeRateSnapshot: patch.exchangeRate ?? destination.exchangeRateSnapshot,
    updatedAt: timestamp
  });

  if (updatedSource.currency === updatedDestination.currency && updatedSource.amount !== updatedDestination.amount) {
    throw new TypeError("Transferência na mesma moeda exige valores iguais.");
  }

  await runAtomic(["transactions"], "readwrite", (stores) => {
    stores.transactions.put(updatedSource);
    stores.transactions.put(updatedDestination);
  });

  return { source: updatedSource, destination: updatedDestination };
}

export async function restoreTransfer(parts) {
  if (!Array.isArray(parts) || parts.length !== 2) throw new TypeError("Snapshot de transferência inválido.");
  const safe = parts.map((part) => normalizeRecord("transactions", part));
  await runAtomic(["transactions"], "readwrite", (stores) => {
    safe.forEach((part) => stores.transactions.put(part));
  });
}
