import { minimizeFinancialContext } from "./privacy.js";

export function buildFinancialContext(analysis, privacyLevel = "local") {
  return minimizeFinancialContext(analysis, privacyLevel);
}

export function buildConversationContext(memory) {
  return {
    lastIntent: memory?.lastIntent || null,
    lastFilters: memory?.lastFilters || null,
    recentMessages: (memory?.messages || []).slice(-6).map((m) => ({ role: m.role, text: String(m.text).slice(0, 300) }))
  };
}
