import { analyzeFinancialData } from "../finance/analytics-engine.js";
import { convertAmount } from "../finance/exchange.js";
import { routeIntent } from "./intent-router.js";
import { buildLocalResponse } from "./local-engine.js";
import { buildAccountResponse } from "./account-context.js";
import { buildFinancialContext, buildConversationContext } from "./context-builder.js";
import { getPrivacySettings, canUseOnlineAI } from "./privacy.js";
import { generateNarrative } from "./online-provider.js";
import { validateMutation, safeText } from "./validators.js";

const MEMORY_KEY = "ProjetoFinancasAIMemory";
const MAX_MESSAGES = 8;
const MUTATION_INTENTS = new Set([
  "create_transaction",
  "update_transaction",
  "delete_transaction",
  "create_transfer",
  "mark_schedule_paid",
  "create_rule"
]);
const ACCOUNT_INTENTS = new Set([
  "available_funds",
  "net_worth",
  "liabilities",
  "upcoming_commitments",
  "reconciliation_status",
  "safe_to_spend"
]);

function loadMemory() {
  try {
    const raw = JSON.parse(sessionStorage.getItem(MEMORY_KEY) || "{}");
    return {
      messages: Array.isArray(raw.messages) ? raw.messages.slice(-MAX_MESSAGES) : [],
      lastIntent: raw.lastIntent || null,
      lastFilters: raw.lastFilters || null
    };
  } catch {
    return { messages: [], lastIntent: null, lastFilters: null };
  }
}

function saveMemory(memory) {
  sessionStorage.setItem(MEMORY_KEY, JSON.stringify({
    ...memory,
    messages: memory.messages.slice(-MAX_MESSAGES)
  }));
}

export function clearConversationMemory() {
  sessionStorage.removeItem(MEMORY_KEY);
}

function remember(memory, role, text) {
  memory.messages.push({ role, text: String(text).slice(0, 500) });
  memory.messages = memory.messages.slice(-MAX_MESSAGES);
  saveMemory(memory);
}

function findMutationTarget(route, transactions) {
  let candidates = transactions.filter((transaction) => transaction.type === "expense");
  if (route.entities.category) {
    candidates = candidates.filter((transaction) => String(transaction.category).toLowerCase() === String(route.entities.category).toLowerCase());
  }
  if (route.entities.currency) candidates = candidates.filter((transaction) => transaction.currency === route.entities.currency);
  if (route.entities.date) candidates = candidates.filter((transaction) => transaction.date === route.entities.date);
  candidates.sort((a, b) => (b.createdAt || b.date).localeCompare(a.createdAt || a.date));
  return candidates;
}

function baseMutationResponse(route) {
  return {
    intent: route.intent,
    confidence: route.confidence,
    title: "Ação financeira",
    summary: "",
    metrics: [],
    observations: [],
    suggestedActions: [],
    clarification: null,
    requiresConfirmation: false,
    proposedMutation: null,
    source: "Interpretação local"
  };
}

function defaultAccountForCurrency(accounts, currency) {
  return accounts.find((account) => !account.archived && account.currency === currency) || null;
}

function buildCreateTransactionMutation(route, accounts, rate) {
  const base = baseMutationResponse(route);
  const entity = route.entities;
  if (!entity.amount || !entity.currency) {
    return {
      ...base,
      title: "Faltam dados",
      clarification: "Informe o valor e a moeda. Exemplo: “Registre 50 reais de gasolina hoje”."
    };
  }

  const account = defaultAccountForCurrency(accounts, entity.currency);
  if (!account) {
    return {
      ...base,
      title: "Falta uma conta",
      clarification: `Cadastre uma conta em ${entity.currency} antes de registrar esta movimentação pelo assistente.`
    };
  }

  const timestamp = new Date().toISOString();
  const mutation = {
    operation: "create_transaction",
    payload: {
      id: crypto.randomUUID?.() || `tx-${Date.now()}`,
      type: entity.type || "expense",
      currency: entity.currency,
      amount: entity.amount,
      accountId: account.id,
      category: safeText(entity.category || "Outros", 60),
      description: safeText(entity.description || entity.category || "Lançamento", 120),
      date: entity.date,
      tags: [],
      status: "cleared",
      exchangeRateSnapshot: entity.currency === "BRL" ? Number(rate) || 1300 : null,
      createdAt: timestamp,
      updatedAt: timestamp
    }
  };

  const validation = validateMutation(mutation);
  if (!validation.ok) return { ...base, title: "Não posso executar", clarification: validation.reason };
  return {
    ...base,
    title: "Confirmar lançamento",
    summary: `Vou registrar ${entity.type === "income" ? "uma entrada" : "uma saída"} na conta “${account.name}”. Confira antes de salvar.`,
    metrics: [{ label: "Valor", value: entity.amount, currency: entity.currency, approximate: false }],
    observations: [`Categoria: ${mutation.payload.category}`, `Data: ${entity.date}`],
    requiresConfirmation: true,
    proposedMutation: mutation
  };
}

function buildTransferMutation(route, accounts, rate) {
  const base = baseMutationResponse(route);
  const source = accounts.find((account) => account.id === route.entities.sourceAccountId);
  const destination = accounts.find((account) => account.id === route.entities.destinationAccountId);
  const amount = Number(route.entities.amount);

  if (!source || !destination || !(amount > 0)) {
    return {
      ...base,
      title: "Preciso de mais detalhes",
      clarification: "Informe o valor e as contas de origem e destino. Exemplo: “Transfira 500 reais da Carteira BRL para a Poupança”."
    };
  }

  if (route.entities.currency && route.entities.currency !== source.currency) {
    return {
      ...base,
      title: "Moeda ambígua",
      clarification: `A conta de origem usa ${source.currency}, mas o pedido menciona ${route.entities.currency}. Confirme o valor na moeda da conta de origem.`
    };
  }

  const exchangeRate = source.currency === destination.currency ? null : Number(rate) || 1300;
  const destinationAmount = convertAmount(amount, source.currency, destination.currency, exchangeRate || 1);
  const mutation = {
    operation: "create_transfer",
    payload: {
      sourceAccountId: source.id,
      destinationAccountId: destination.id,
      sourceCurrency: source.currency,
      destinationCurrency: destination.currency,
      sourceAmount: amount,
      destinationAmount,
      exchangeRate,
      date: route.entities.date,
      description: "Transferência por assistente"
    }
  };
  const validation = validateMutation(mutation);
  if (!validation.ok) return { ...base, title: "Não posso executar", clarification: validation.reason };

  return {
    ...base,
    title: "Confirmar transferência",
    summary: `Transferir da conta “${source.name}” para “${destination.name}”.`,
    metrics: [
      { label: "Origem", value: amount, currency: source.currency, approximate: false },
      { label: "Destino", value: destinationAmount, currency: destination.currency, approximate: source.currency !== destination.currency }
    ],
    observations: exchangeRate ? [`Cotação utilizada: 1 BRL = ${exchangeRate} PYG.`] : [],
    requiresConfirmation: true,
    proposedMutation: mutation
  };
}

function buildSchedulePaidMutation(route, schedules) {
  const base = baseMutationResponse(route);
  const schedule = schedules.find((item) => item.id === route.entities.scheduleId);
  if (!schedule) {
    return {
      ...base,
      title: "Qual compromisso?",
      clarification: "Não identifiquei com segurança o compromisso a marcar como pago. Use o nome cadastrado."
    };
  }

  const mutation = {
    operation: "mark_schedule_paid",
    payload: { scheduleId: schedule.id, date: route.entities.date || schedule.nextDueDate }
  };
  const validation = validateMutation(mutation);
  if (!validation.ok) return { ...base, title: "Não posso executar", clarification: validation.reason };
  return {
    ...base,
    title: "Confirmar pagamento",
    summary: `Marcar “${schedule.name}” como pago e criar a movimentação correspondente?`,
    metrics: [{ label: "Valor", value: schedule.amount, currency: schedule.currency, approximate: false }],
    observations: [`Vencimento cadastrado: ${schedule.nextDueDate}.`],
    requiresConfirmation: true,
    proposedMutation: mutation
  };
}

function buildRuleMutation(route) {
  const base = baseMutationResponse(route);
  if (!route.entities.needle || !route.entities.category) {
    return {
      ...base,
      title: "Regra incompleta",
      clarification: "Exemplo: “Crie uma regra para categorizar Maxi como Mercado”."
    };
  }
  const mutation = {
    operation: "create_rule",
    payload: {
      id: crypto.randomUUID?.() || `rule-${Date.now()}`,
      name: `Categorizar ${safeText(route.entities.needle, 60)} como ${safeText(route.entities.category, 60)}`,
      enabled: true,
      priority: 100,
      conditions: [{ field: "description", operator: "contains", value: safeText(route.entities.needle, 80) }],
      actions: [{ field: "category", value: safeText(route.entities.category, 60) }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  };
  const validation = validateMutation(mutation);
  if (!validation.ok) return { ...base, title: "Não posso executar", clarification: validation.reason };
  return {
    ...base,
    title: "Confirmar regra",
    summary: `Quando a descrição contiver “${route.entities.needle}”, sugerir a categoria “${route.entities.category}”.`,
    observations: ["A regra é local e não executa código."],
    requiresConfirmation: true,
    proposedMutation: mutation
  };
}

function buildTransactionMutation(route, transactions, accounts, rate) {
  if (route.intent === "create_transaction") return buildCreateTransactionMutation(route, accounts, rate);
  if (route.intent === "create_transfer") return buildTransferMutation(route, accounts, rate);

  const base = baseMutationResponse(route);
  const candidates = findMutationTarget(route, transactions);
  if (!candidates.length) {
    return { ...base, title: "Nenhuma correspondência", clarification: "Não encontrei uma transação que corresponda ao pedido." };
  }
  if (candidates.length > 1 && !route.entities.last) {
    const labels = candidates.slice(0, 3).map((transaction) => `${transaction.description} — ${transaction.currency} ${transaction.amount} em ${transaction.date}`);
    return {
      ...base,
      title: "Qual transação?",
      clarification: `Encontrei mais de uma opção: ${labels.join("; ")}. Seja mais específico ou diga “a última”.`
    };
  }

  const target = candidates[0];
  if (route.intent === "delete_transaction") {
    return {
      ...base,
      title: "Confirmar exclusão",
      summary: `Você quer excluir “${target.description}”?`,
      requiresConfirmation: true,
      proposedMutation: { operation: "delete_transaction", payload: { id: target.id }, undoSnapshot: target }
    };
  }

  if (route.intent === "update_transaction") {
    const payload = {
      ...target,
      amount: route.entities.amount || target.amount,
      currency: route.entities.currency || target.currency,
      updatedAt: new Date().toISOString()
    };
    const mutation = { operation: "update_transaction", payload, undoSnapshot: target };
    const validation = validateMutation(mutation);
    if (!validation.ok) return { ...base, title: "Não posso executar", clarification: validation.reason };
    return {
      ...base,
      title: "Confirmar alteração",
      summary: `Vou alterar “${target.description}”. Confira os dados antes de salvar.`,
      requiresConfirmation: true,
      proposedMutation: mutation
    };
  }

  return base;
}

export async function askFinancialAssistant({
  question,
  transactions = [],
  goals = [],
  budgets = [],
  categories = [],
  accounts = [],
  schedules = [],
  rates = [],
  rate = 1300,
  baseCurrency = "PYG",
  onlineEndpoint,
  signal
}) {
  const memory = loadMemory();
  const route = routeIntent(question, { categories, accounts, schedules, memory });
  memory.lastIntent = route.intent;
  memory.lastFilters = route.filters;
  remember(memory, "user", question);

  if (MUTATION_INTENTS.has(route.intent)) {
    let response;
    if (["create_transaction", "update_transaction", "delete_transaction", "create_transfer"].includes(route.intent)) {
      response = buildTransactionMutation(route, transactions, accounts, rate);
    } else if (route.intent === "mark_schedule_paid") {
      response = buildSchedulePaidMutation(route, schedules);
    } else {
      response = buildRuleMutation(route);
    }
    remember(memory, "assistant", response.summary || response.clarification || response.title);
    return { response, route, mode: navigator.onLine ? "Análise local" : "Modo offline" };
  }

  if (ACCOUNT_INTENTS.has(route.intent)) {
    const response = buildAccountResponse(route, {
      accounts,
      transactions,
      schedules,
      goals,
      budgets,
      rate,
      baseCurrency
    });
    remember(memory, "assistant", response.summary || response.clarification || response.title);
    return { response, route, mode: navigator.onLine ? "Análise local" : "Modo offline" };
  }

  const analysis = analyzeFinancialData({
    transactions,
    goals,
    budgets,
    rate,
    rates,
    period: route.filters.period,
    filters: route.filters
  });
  const local = buildLocalResponse(route, analysis, { baseCurrency });
  const privacy = getPrivacySettings();

  if (canUseOnlineAI(privacy) && navigator.onLine) {
    try {
      const narrative = await generateNarrative({
        intent: route.intent,
        question,
        financialContext: buildFinancialContext(analysis, privacy.level),
        conversationContext: buildConversationContext(memory),
        endpoint: onlineEndpoint || "/api/financial-assistant",
        signal
      });
      const response = {
        ...local,
        ...narrative,
        metrics: local.metrics,
        confidence: route.confidence,
        intent: route.intent
      };
      remember(memory, "assistant", response.summary);
      return { response, route, analysis, mode: "Assistente online" };
    } catch {
      local.observations = [...(local.observations || []), "Estou usando a análise local neste momento."];
    }
  }

  remember(memory, "assistant", local.summary || local.clarification || local.title);
  return {
    response: local,
    route,
    analysis,
    mode: navigator.onLine ? "Análise local" : "Modo offline"
  };
}
