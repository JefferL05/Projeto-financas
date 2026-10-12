import { describe, expect, test } from "vitest";
import { findFinancialKnowledgeAnswer } from "../js/ai/financial-knowledge.js";

describe("base de conhecimento financeiro local", () => {
  test("responde sobre privacidade sem depender da IA online", () => {
    const result = findFinancialKnowledgeAnswer("Como funciona a privacidade dos dados?");
    expect(result?.knowledgeId).toBe("privacy");
    expect(result?.summary).toContain("próprio dispositivo");
    expect(result?.source).toBe("Base de conhecimento local");
  });

  test("explica funcionamento offline", () => {
    const result = findFinancialKnowledgeAnswer("O assistente funciona sem internet offline?");
    expect(result?.knowledgeId).toBe("offline");
    expect(result?.summary).toContain("IndexedDB");
  });

  test("explica que transferências não são receitas nem despesas", () => {
    const result = findFinancialKnowledgeAnswer("Transferências contam como receitas ou despesas?");
    expect(result?.knowledgeId).toBe("transfers");
  });

  test("explica custos variáveis da IA online sem prometer gratuidade", () => {
    const result = findFinancialKnowledgeAnswer("A IA online é gratuita ou tem custo de API?");
    expect(result?.knowledgeId).toBe("online-cost");
  });

  test("não inventa resposta para perguntas sem correspondência", () => {
    expect(findFinancialKnowledgeAnswer("Qual é a previsão do tempo amanhã?")).toBeNull();
  });

  test("entrada vazia ou só com palavras comuns não retorna resposta", () => {
    expect(findFinancialKnowledgeAnswer("")).toBeNull();
    expect(findFinancialKnowledgeAnswer("como é que")).toBeNull();
  });
});
