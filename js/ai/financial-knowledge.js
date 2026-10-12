const ARTICLES = [
  {
    id: "privacy",
    title: "Como funciona a privacidade do assistente?",
    keywords: ["privacidade", "dados", "enviar", "online", "consentimento", "local"],
    answer: "Por padrão, a análise financeira acontece no próprio dispositivo. Para usar IA online, habilite a opção nas configurações de privacidade e escolha o nível de compartilhamento. Nunca coloque chaves de API no navegador."
  },
  {
    id: "offline",
    title: "O assistente funciona sem internet?",
    keywords: ["offline", "internet", "sem", "conexao", "conexão", "funciona"],
    answer: "Sim. O motor local usa os dados disponíveis no IndexedDB e continua fazendo cálculos sem internet. A geração de texto por IA online exige conexão e um backend configurado; se ela falhar, o assistente retorna à análise local."
  },
  {
    id: "currencies",
    title: "Como são tratados BRL e PYG?",
    keywords: ["brl", "pyg", "moeda", "reais", "guarani", "guaranis", "cotacao", "cotação", "conversao", "conversão"],
    answer: "O Projeto Finanças mantém valores originais em BRL e PYG. Quando precisa comparar moedas, usa a cotação disponível e identifica estimativas quando a cotação histórica não está disponível. Confira a moeda e a cotação antes de tomar decisões."
  },
  {
    id: "transfers",
    title: "Transferências contam como receitas ou despesas?",
    keywords: ["transferencia", "transferência", "transferencias", "transferências", "receita", "despesa", "saldo"],
    answer: "Não. Transferências entre contas são movimentações internas e não devem inflar receitas nem despesas nos relatórios. O sistema relaciona as duas pontas da transferência."
  },
  {
    id: "budgets",
    title: "Como funcionam os orçamentos por categoria?",
    keywords: ["orcamento", "orçamento", "limite", "categoria", "gasto", "gastos"],
    answer: "Os orçamentos comparam as despesas registradas de uma categoria com o limite definido para o período. Revise os lançamentos e a moeda antes de alterar um limite; um alerta é um sinal para investigar, não uma conclusão automática."
  },
  {
    id: "recurring",
    title: "Como são encontrados gastos recorrentes e anomalias?",
    keywords: ["recorrente", "recorrentes", "assinatura", "anomalia", "anomalias", "fora", "padrao", "padrão"],
    answer: "O motor local procura padrões no histórico de transações e identifica valores ou frequências que merecem revisão. Os resultados são indícios, não garantias: confirme se o lançamento é realmente incomum antes de agir."
  },
  {
    id: "backup",
    title: "Como faço backup dos meus dados?",
    keywords: ["backup", "exportar", "restaurar", "dados", "arquivo", "seguranca", "segurança"],
    answer: "Use as opções de backup e restauração do Projeto Finanças para exportar os registros e guardá-los em um local seguro. O backup pode conter informações financeiras sensíveis; não o compartilhe publicamente."
  },
  {
    id: "online-cost",
    title: "A IA online é gratuita?",
    keywords: ["ia", "online", "gratuita", "gratis", "grátis", "custo", "api", "chave"],
    answer: "A análise local não exige serviço externo. O custo da IA generativa depende do provedor, modelo e volume de uso; ela só deve ser habilitada com um backend seguro e credenciais armazenadas no servidor."
  },
  {
    id: "financial-advice",
    title: "As recomendações garantem economia ou retorno?",
    keywords: ["recomendacao", "recomendação", "economizar", "investimento", "retorno", "garantia", "investir"],
    answer: "Não. As recomendações são apoio à organização financeira, baseadas nos registros e regras disponíveis. Projeções dependem das hipóteses usadas e não garantem resultados; decisões de investimento devem considerar riscos e sua situação completa."
  }
];

const STOP_WORDS = new Set([
  "a", "as", "o", "os", "um", "uma", "uns", "umas", "de", "da", "do", "das", "dos",
  "e", "ou", "em", "no", "na", "nos", "nas", "para", "por", "com", "que", "como",
  "meu", "minha", "meus", "minhas", "funciona", "sobre", "qual", "quais", "é", "ser"
]);

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(value) {
  return normalize(value).split(/\s+/).filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

/**
 * Searches a small, bundled financial FAQ without network access or external dependencies.
 * Returns null when the question is not a confident match.
 */
export function findFinancialKnowledgeAnswer(question) {
  const queryTokens = new Set(tokens(question));
  if (!queryTokens.size) return null;

  let best = null;
  for (const article of ARTICLES) {
    const searchable = new Set(tokens([
      article.title,
      ...article.keywords,
      article.answer
    ].join(" ")));
    let matches = 0;
    for (const token of queryTokens) {
      if (searchable.has(token)) matches += 1;
    }
    const coverage = matches / queryTokens.size;
    const precision = matches / Math.max(searchable.size, 1);
    const score = coverage * 0.75 + precision * 0.25;
    if (!best || score > best.score) best = { article, score, matches };
  }

  if (!best || best.matches < 2 || best.score < 0.22) return null;
  return {
    title: best.article.title,
    summary: best.article.answer,
    observations: ["Resposta da base de conhecimento local; não foi necessário enviar dados para um serviço externo."],
    suggestedActions: [],
    source: "Base de conhecimento local",
    knowledgeId: best.article.id,
    confidence: Math.min(0.95, Number(best.score.toFixed(2)))
  };
}
