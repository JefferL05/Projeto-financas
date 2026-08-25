import { analyzeFinancialData } from "../finance/analytics-engine.js";
import { routeIntent } from "./intent-router.js";
import { buildLocalResponse } from "./local-engine.js";
import { buildFinancialContext, buildConversationContext } from "./context-builder.js";
import { getPrivacySettings, canUseOnlineAI } from "./privacy.js";
import { generateNarrative } from "./online-provider.js";
import { validateMutation, safeText } from "./validators.js";

const MEMORY_KEY = "ProjetoFinancasAIMemory";
const MAX_MESSAGES = 8;

function loadMemory() {
  try {
    const raw = JSON.parse(sessionStorage.getItem(MEMORY_KEY) || "{}");
    return { messages: Array.isArray(raw.messages) ? raw.messages.slice(-MAX_MESSAGES) : [], lastIntent: raw.lastIntent || null, lastFilters: raw.lastFilters || null };
  } catch {
    return { messages: [], lastIntent: null, lastFilters: null };
  }
}

function saveMemory(memory) {
  sessionStorage.setItem(MEMORY_KEY, JSON.stringify({ ...memory, messages: memory.messages.slice(-MAX_MESSAGES) }));
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
  let candidates = transactions.filter((t) => t.type === "expense");
  if (route.entities.category) candidates = candidates.filter((t) => String(t.category).toLowerCase() === String(route.entities.category).toLowerCase());
  if (route.entities.currency) candidates = candidates.filter((t) => t.currency === route.entities.currency);
  if (route.entities.date) candidates = candidates.filter((t) => t.date === route.entities.date);
  candidates.sort((a, b) => (b.createdAt || b.date).localeCompare(a.createdAt || a.date));
  return candidates;
}

function buildMutationResponse(route, transactions) {
  const base = {
    intent: route.intent,
    confidence: route.confidence,
    title: "Ação financeira",
    summary: "",
    metrics: [],
    observations: [],
    suggestedActions: [],
    clarification: null,
    requiresConfirmation: false,
    proposedMutation: null
  };

  if (route.intent === "create_transaction") {
    const e = route.entities;
    if (!e.amount || !e.currency) {
      return { ...base, title: "Faltam dados", clarification: "Informe o valor e a moeda. Exemplo: “Registre 50 reais de gasolina hoje”." };
    }
    const mutation = {
      operation: "create_transaction",
      payload: {
        id: crypto.randomUUID?.() || `tx-${Date.now()}`,
        type: e.type || "expense",
        currency: e.currency,
        amount: e.amount,
        category: safeText(e.category || "Outros", 60),
        description: safeText(e.description || e.category || "Lançamento", 120),
        date: e.date,
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    };
    const validation = validateMutation(mutation);
    if (!validation.ok) return { ...base, title: "Não posso executar", clarification: validation.reason };
    return { ...base, title: "Confirmar lançamento", summary: "Entendi o lançamento abaixo. Confira antes de salvar.", requiresConfirmation: true, proposedMutation: mutation };
  }

  const candidates = findMutationTarget(route, transactions);
  if (!candidates.length) return { ...base, title: "Nenhuma correspondência", clarification: "Não encontrei uma transação que corresponda ao pedido." };
  if (candidates.length > 1 && !route.entities.last) {
    const labels = candidates.slice(0, 3).map((t) => `${t.description} — ${t.currency} ${t.amount} em ${t.date}`);
    return { ...base, title: "Qual transação?", clarification: `Encontrei mais de uma opção: ${labels.join("; ")}. Seja mais específico ou diga “a última”.` };
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
    const amount = route.entities.amount || target.amount;
    const currency = route.entities.currency || target.currency;
    const payload = { ...target, amount, currency, updatedAt: new Date().toISOString() };
    const mutation = { operation: "update_transaction", payload, undoSnapshot: target };
    const validation = validateMutation(mutation);
    if (!validation.ok) return { ...base, title: "Não posso executar", clarification: validation.reason };
    return { ...base, title: "Confirmar alteração", summary: `Vou alterar “${target.description}”. Confira os dados antes de salvar.`, requiresConfirmation: true, proposedMutation: mutation };
  }

  return base;
}

export async function askFinancialAssistant({ question, transactions, goals, budgets, categories, rate, onlineEndpoint, signal }) {
  const memory = loadMemory();
  const route = routeIntent(question, { categories, memory });
  memory.lastIntent = route.intent;
  memory.lastFilters = route.filters;
  remember(memory, "user", question);

  if (["create_transaction", "update_transaction", "delete_transaction"].includes(route.intent)) {
    const response = buildMutationResponse(route, transactions);
    remember(memory, "assistant", response.summary || response.clarification || response.title);
    return { response, route, mode: "Análise local" };
  }

  const analysis = analyzeFinancialData({ transactions, goals, budgets, rate, period: route.filters.period, filters: route.filters });
  const local = buildLocalResponse(route, analysis);
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
      const response = { ...local, ...narrative, metrics: local.metrics, confidence: route.confidence, intent: route.intent };
      remember(memory, "assistant", response.summary);
      return { response, route, analysis, mode: "Assistente online" };
    } catch {
      local.observations = [...(local.observations || []), "Estou usando a análise local neste momento."];
    }
  }

  remember(memory, "assistant", local.summary || local.clarification || local.title);
  return { response: local, route, analysis, mode: navigator.onLine ? "Análise local" : "Modo offline" };
}
