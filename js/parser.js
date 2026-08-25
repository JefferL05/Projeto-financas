import { bulkPut, getAll, put } from "./db.js";
import { parseLooseNumber, todayISO, uid } from "./utils.js";

function inferCategory(line) {
  const text = line.toLowerCase();
  if (/mercado|supermercado|maxi|atacad/.test(text)) return "Mercado";
  if (/almoço|almoco|jantar|lanche|comida|restaurante/.test(text)) return "Alimentação";
  if (/gasolina|combustível|combustivel|posto/.test(text)) return "Combustível";
  if (/uber|ônibus|onibus|taxi|transporte/.test(text)) return "Transporte";
  if (/aluguel|energia|luz|água|agua|internet|moradia/.test(text)) return "Moradia";
  if (/farmácia|farmacia|saúde|saude|médico|medico/.test(text)) return "Saúde";
  if (/cinema|jogo|lazer|passeio/.test(text)) return "Lazer";
  if (/curso|faculdade|livro|educação|educacao/.test(text)) return "Educação";
  if (/salário|salario|pagamento|folha/.test(text)) return "Salário";
  if (/compra|shopping|loja/.test(text)) return "Compras";
  return "Outros";
}

function inferCurrency(line, fallback) {
  if (/(r\$|reais?|brl)/i.test(line)) return "BRL";
  if (/(gs\.?|guaranis?|pyg|₲)/i.test(line)) return "PYG";
  return fallback;
}

function inferType(line) {
  if (/(recebi|receita|entrada|sal[aá]rio|ganhei|depósito|deposito|\+)/i.test(line)) return "income";
  return "expense";
}

export function parseSmartInput(text, fallbackCurrency = "PYG") {
  const lines = String(text || "").split(/\n+/).map((item) => item.trim()).filter(Boolean);
  const results = [];
  let sectionCurrency = fallbackCurrency;

  for (const line of lines) {
    if (/^(guarani|guaranis|pyg|gs\.?|₲)$/i.test(line)) {
      sectionCurrency = "PYG";
      continue;
    }
    if (/^(real|reais|brl|r\$)$/i.test(line)) {
      sectionCurrency = "BRL";
      continue;
    }

    const currency = inferCurrency(line, sectionCurrency);
    const type = inferType(line);
    const matches = line.match(/-?\s*\d[\d.,]*/g) || [];

    for (const match of matches) {
      const amount = Math.abs(parseLooseNumber(match, {
        localeHint: currency === "BRL" ? "pt-BR" : null
      }));
      if (!Number.isFinite(amount) || amount <= 0) continue;

      let description = line
        .replace(match, " ")
        .replace(/\b(recebi|receita|entrada|gasto|gastos|despesa|despesas|reais?|guaranis?|brl|pyg)\b/gi, " ")
        .replace(/r\$|gs\.?|₲/gi, " ")
        .replace(/[+\-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      if (!description) description = type === "income" ? "Receita" : "Despesa";

      results.push({
        type,
        currency,
        amount: currency === "PYG" ? Math.round(amount) : Number(amount.toFixed(2)),
        category: inferCategory(line),
        description,
        tags: []
      });
    }
  }

  return results;
}

async function ensureWallet(currency) {
  const accounts = await getAll("accounts");
  const existing = accounts.find((account) => !account.archived && account.currency === currency);
  if (existing) return existing;

  const id = `account-wallet-${currency.toLowerCase()}`;
  const account = {
    id,
    name: `Carteira ${currency}`,
    type: "cash",
    currency,
    openingBalance: 0,
    onBudget: true,
    includeInNetWorth: true,
    archived: false,
    color: "",
    icon: "wallet",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastReconciledAt: null
  };
  await put("accounts", account);
  return account;
}

async function persistQuickImport(text, fallbackCurrency) {
  const suggestions = parseSmartInput(text, fallbackCurrency);
  if (!suggestions.length) throw new TypeError("Nenhum lançamento válido foi encontrado no texto.");

  const wallets = {};
  for (const currency of new Set(suggestions.map((item) => item.currency))) {
    wallets[currency] = await ensureWallet(currency);
  }

  const timestamp = new Date().toISOString();
  const date = todayISO();
  const items = suggestions.map((suggestion) => ({
    id: uid("tx"),
    ...suggestion,
    accountId: wallets[suggestion.currency].id,
    date,
    status: "cleared",
    clearedAt: timestamp,
    reconciledAt: null,
    exchangeRateSnapshot: suggestion.currency === "BRL" ? null : null,
    createdAt: timestamp,
    updatedAt: timestamp
  }));

  await bulkPut("transactions", items);
  return items.length;
}

function showQuickImportFeedback(message, isError = false) {
  const toast = document.querySelector("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("show");
  window.setTimeout(() => {
    toast.classList.remove("show");
    toast.classList.remove("error");
  }, 3000);
}

if (typeof document !== "undefined") {
  document.addEventListener("click", async (event) => {
    const button = event.target.closest?.("#importSmartBtn");
    if (!button) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const input = document.querySelector("#smartInput");
    const currency = document.querySelector("#smartDefaultCurrency");
    const dialog = document.querySelector("#smartImportDialog");
    const originalLabel = button.textContent;

    button.disabled = true;
    button.textContent = "Importando...";

    try {
      const count = await persistQuickImport(input?.value || "", currency?.value || "PYG");
      if (input) input.value = "";
      showQuickImportFeedback(`${count} lançamento(s) importado(s) com sucesso.`);
      dialog?.close();
      window.setTimeout(() => window.location.reload(), 250);
    } catch (error) {
      console.error("Falha na importação rápida:", error);
      showQuickImportFeedback(error?.message || "Não foi possível importar os lançamentos.", true);
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }, true);
}
