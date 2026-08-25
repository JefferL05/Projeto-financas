import { parseLooseNumber } from "./utils.js";

const SUPPORTED_CURRENCIES = new Set(["BRL", "PYG"]);

const CATEGORY_RULES = [
  ["Mercado", /mercado|supermercado|maxi|atacad/i],
  ["Alimentação", /almoço|almoco|jantar|lanche|comida|restaurante/i],
  ["Combustível", /gasolina|combustível|combustivel|posto/i],
  ["Transporte", /uber|ônibus|onibus|taxi|transporte/i],
  ["Moradia", /aluguel|energia|luz|água|agua|internet|moradia/i],
  ["Saúde", /farmácia|farmacia|saúde|saude|médico|medico/i],
  ["Lazer", /cinema|jogo|lazer|passeio/i],
  ["Educação", /curso|faculdade|livro|educação|educacao/i],
  ["Salário", /salário|salario|pagamento|folha/i],
  ["Compras", /compra|shopping|loja/i]
];

const INCOME_PATTERN = /(recebi|receita|entrada|sal[aá]rio|ganhei|depósito|deposito|\+)/i;
const VALUE_PATTERN = /-?\s*\d[\d.,]*/g;
const MARKUP_PATTERN = /<[^>]*>/g;

function normalizeFallbackCurrency(currency) {
  return SUPPORTED_CURRENCIES.has(currency) ? currency : "PYG";
}

export function inferCategory(line) {
  const text = String(line || "");
  return CATEGORY_RULES.find(([, pattern]) => pattern.test(text))?.[0] || "Outros";
}

export function inferCurrency(line, fallbackCurrency = "PYG") {
  const text = String(line || "");
  if (/(r\$|reais?|brl)/i.test(text)) return "BRL";
  if (/(gs\.?|guaranis?|pyg|₲)/i.test(text)) return "PYG";
  return normalizeFallbackCurrency(fallbackCurrency);
}

export function inferType(line) {
  return INCOME_PATTERN.test(String(line || "")) ? "income" : "expense";
}

function isCurrencyHeader(line) {
  if (/^(guarani|guaranis|pyg|gs\.?|₲)$/i.test(line)) return "PYG";
  if (/^(real|reais|brl|r\$)$/i.test(line)) return "BRL";
  return null;
}

function cleanDescription(line, matchedValue, type) {
  const description = line
    .replace(matchedValue, " ")
    .replace(/\b(recebi|receita|entrada|gasto|gastos|despesa|despesas|reais?|guaranis?|brl|pyg)\b/gi, " ")
    .replace(/r\$|gs\.?|₲/gi, " ")
    .replace(/[+\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return description || (type === "income" ? "Receita" : "Despesa");
}

function parseAmount(rawValue, currency) {
  const amount = Math.abs(parseLooseNumber(rawValue, {
    localeHint: currency === "BRL" ? "pt-BR" : null
  }));

  if (!Number.isFinite(amount) || amount <= 0) return null;
  return currency === "PYG" ? Math.round(amount) : Number(amount.toFixed(2));
}

function extractValueMatches(line) {
  // Tags/atributos são tratados apenas como texto descritivo. Números dentro
  // deles não podem criar lançamentos adicionais, por exemplo alert(1).
  const searchable = line.replace(MARKUP_PATTERN, " ");
  return searchable.match(VALUE_PATTERN) || [];
}

export function parseSmartInput(text, fallbackCurrency = "PYG") {
  const lines = String(text || "")
    .split(/\r?\n+/)
    .map((item) => item.trim())
    .filter(Boolean);

  const results = [];
  let sectionCurrency = normalizeFallbackCurrency(fallbackCurrency);

  for (const line of lines) {
    const headerCurrency = isCurrencyHeader(line);
    if (headerCurrency) {
      sectionCurrency = headerCurrency;
      continue;
    }

    const currency = inferCurrency(line, sectionCurrency);
    const type = inferType(line);
    const matches = extractValueMatches(line);

    for (const match of matches) {
      const amount = parseAmount(match, currency);
      if (amount === null) continue;

      results.push({
        type,
        currency,
        amount,
        category: inferCategory(line),
        description: cleanDescription(line, match, type),
        tags: []
      });
    }
  }

  return results;
}
