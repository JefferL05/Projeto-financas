# Projeto Finanças 🇵🇾 🇧🇷

Aplicação web de gestão financeira pessoal multi-moeda construída com HTML, CSS e JavaScript ES Modules, com funcionamento local-first, IndexedDB e PWA.

## Recursos principais

- Entradas e saídas em PYG e BRL
- Dashboard multi-moeda e patrimônio consolidado
- Cotação manual e consulta opcional BRL → PYG
- Categorias, tags, busca e filtros
- Importação rápida de anotações
- Importação/exportação JSON e CSV
- Metas de longo prazo
- Orçamentos mensais por categoria
- Analytics e projeções
- Detecção local de recorrências e gastos fora do padrão
- Assistente financeiro híbrido com fallback offline
- PWA/Service Worker

## Arquitetura do assistente

O modelo externo nunca é responsável pelos cálculos financeiros principais. O fluxo é:

1. `IndexedDB` armazena os dados.
2. `js/finance/analytics-engine.js` valida e calcula métricas.
3. `js/ai/intent-router.js` interpreta a pergunta e extrai período/filtros.
4. `js/ai/local-engine.js` gera uma resposta estruturada usando os cálculos locais.
5. Se a IA online estiver habilitada e houver consentimento, `js/ai/online-provider.js` envia somente contexto minimizado para um backend seguro.
6. Se o backend falhar, o assistente continua com análise local.
7. `js/ai/response-renderer.js` renderiza respostas usando criação de DOM e `textContent`.

### Módulos

```text
js/
├── ai/
│   ├── assistant.js
│   ├── context-builder.js
│   ├── intent-router.js
│   ├── local-engine.js
│   ├── online-provider.js
│   ├── privacy.js
│   ├── response-renderer.js
│   └── validators.js
├── finance/
│   ├── analytics-engine.js
│   ├── anomaly-detector.js
│   ├── budget-engine.js
│   ├── period-utils.js
│   ├── projections.js
│   └── recurring-detector.js
├── app.js
├── db.js
├── inteligencia.js
├── parser.js
└── utils.js
```

## IndexedDB e migração

Banco: `ProjetoFinancasDB`.

Versão atual: **5**.

A migração é incremental e não remove stores existentes. A versão 5 adiciona a store `budgets`, preservando:

- `transactions`
- `settings`
- `categories`
- `exchangeRates`
- `goals`

Stores atuais:

- `transactions`
- `settings`
- `categories`
- `exchangeRates`
- `goals`
- `budgets`

## Assistente local

O assistente entende, entre outras, perguntas sobre:

- hoje, ontem, esta semana e meses;
- gastos e receitas;
- categorias e moedas;
- comparação com período anterior;
- taxa de poupança;
- projeção mensal;
- recorrências;
- gastos fora do padrão;
- metas;
- orçamentos.

Também pode propor criação, edição e exclusão de transações. Toda mutação exige confirmação explícita antes de alterar o IndexedDB e a última ação pode ser desfeita durante a sessão.

A memória conversacional usa `sessionStorage`, mantém somente poucas mensagens e não entra no backup financeiro.

## Privacidade

O padrão é **Somente análise local**.

Níveis disponíveis:

1. Somente análise local.
2. IA online com dados agregados.
3. IA online com detalhes selecionados.

Nenhuma chave de API deve ser colocada em HTML, JavaScript do navegador, IndexedDB, LocalStorage, Service Worker ou repositório GitHub.

## Backend opcional da IA

GitHub Pages é hospedagem estática. Para IA generativa real é necessário um backend/função serverless separado.

O frontend espera:

```http
POST /api/financial-assistant
Content-Type: application/json
```

Corpo aproximado:

```json
{
  "intent": "compare_periods",
  "question": "Compare este mês com o mês passado",
  "financialContext": {},
  "conversationContext": {}
}
```

Resposta esperada:

```json
{
  "title": "Comparação mensal",
  "summary": "Seus gastos diminuíram neste mês.",
  "observations": [],
  "suggestedActions": []
}
```

O backend deve manter a chave em variável de ambiente, validar campos, aplicar limite de tamanho, rate limiting, timeout, CORS restrito e evitar logs com dados financeiros completos. O modelo deve apenas explicar dados previamente calculados pelo aplicativo.

## Segurança

- Validação de moedas, tipos, valores e datas.
- Lista permitida de operações mutáveis.
- Conteúdo financeiro tratado como dados, não instruções.
- Detecção básica de padrões de prompt injection.
- Renderização segura do assistente via `textContent`.
- Service Worker não intercepta nem armazena em cache `/api/financial-assistant`.
- IA online desativada por padrão.
- Importações continuam sujeitas às validações do aplicativo.

## Testes

Os testes usam somente dados fictícios.

Abra com servidor local e acesse:

```text
http://localhost:8080/tests/
```

Cobertura atual inclui:

- receitas/despesas e saldo;
- conversão BRL/PYG;
- período vazio e mês sem receita;
- taxa de poupança;
- recorrências;
- anomalias;
- metas concluídas e vencidas;
- interpretação de intenção/moeda;
- comparação de períodos;
- tentativa de prompt injection;
- conteúdo HTML malicioso.

## Executar localmente

```bash
python -m http.server 8080
```

Abra:

```text
http://localhost:8080
```

## Publicação

O front-end é compatível com GitHub Pages. A IA local funciona normalmente no Pages. A IA online só funciona se o endpoint configurado apontar para um backend separado acessível por HTTPS e com CORS configurado.

## Limitações atuais

- O roteador local usa regras linguísticas e não substitui um modelo de linguagem para perguntas muito abertas.
- Detecção de recorrência/anomalia é heurística e explicável, não detecção de fraude.
- A cotação usada em valores consolidados pode ser aproximada.
- GitHub Pages não hospeda o backend da IA generativa.
- Dados continuam locais por dispositivo até existir sincronização opcional com backend/banco remoto.
