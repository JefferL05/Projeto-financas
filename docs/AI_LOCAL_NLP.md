# Assistente Financeiro Local — NLP determinístico

## Objetivo

O assistente do Projeto Finanças funciona como uma camada de linguagem natural sobre o domínio financeiro local. A interpretação pode ser heurística/NLP, mas saldos, diferenças, projeções e demais números financeiros continuam sendo calculados por funções determinísticas.

## Fluxo

```text
Pergunta
  ↓
normalização de linguagem
  ↓
extração de entidades
  ↓
pontuação/classificação de intenção
  ↓
resolução de conta/contexto
  ↓
motor financeiro local
  ↓
resposta estruturada
  ↓
renderização conversacional segura
```

## Módulos principais

- `js/ai/entity-extractor.js`: normalização, moeda, valores assinados, contas e linguagem informal.
- `js/ai/intent-router.js`: classificação por sinais combinados e pontuação de confiança.
- `js/ai/assistant.js`: memória curta por sessão e orquestração.
- `js/ai/account-context.js`: respostas baseadas nas contas reais cadastradas.
- `js/finance/account-targets.js`: cálculos determinísticos de zeragem e alvo de saldo.
- `js/ai/response-renderer.js`: renderização segura usando DOM/textContent.

## Intenções de conta adicionadas

### `account_balance`

Exemplos:

- `Quanto tenho em reais?`
- `Qual o saldo da Carteira PYG?`

### `account_zero_balance`

Exemplos:

- `Como zero minha conta Guarani?`
- `Quanto falta pra zerar?`
- `Quero sair do negativo na conta Guarani.`
- `Minha guarani tá -99, como arrumo isso?`

O saldo mencionado na frase não substitui o saldo cadastrado. O sistema resolve a conta e calcula o saldo atual com `accountSummary()`. Em seguida `calculateAmountToZero()` calcula a diferença até zero.

### `account_target`

Exemplos:

- `Quanto falta para chegar em 1 milhão na Carteira PYG?`
- `E quanto falta para 1 milhão?` após consultar uma conta.

O extrator reconhece abreviações como `500 mil` e `1 milhão`.

## Ambiguidade

Quando só existe uma conta ativa na moeda solicitada, ela pode ser resolvida automaticamente. Se houver mais de uma conta compatível e nenhuma for nomeada explicitamente, o assistente pede esclarecimento e lista as opções.

## Memória curta

A conversa mantém no `sessionStorage` apenas um contexto curto:

- últimas mensagens;
- última intenção;
- últimos filtros;
- últimas entidades relevantes, incluindo conta.

Isso permite perguntas de continuação como:

```text
Quanto tenho na Carteira PYG?
E quanto falta para 1 milhão?
```

ou:

```text
Quanto gastei?
Esse mês.
Com mercado.
```

A memória é apagável pelo botão **Limpar conversa** e não faz parte do backup financeiro.

## Segurança

- nenhuma chave de API é armazenada no cliente;
- o assistente local não usa `eval()` ou `Function()`;
- descrições e perguntas são tratadas como dados, não comandos executáveis;
- respostas são renderizadas com APIs DOM seguras;
- a IA online continua opcional;
- números críticos nunca são substituídos por narrativa gerada externamente;
- mutações financeiras existentes continuam exigindo confirmação explícita.

## Regressão principal

Pergunta:

```text
Como faço pra deixar zero minha conta Guarani : Esta -99
```

Com uma única `Carteira PYG` cujo saldo real seja `-99`, o comportamento esperado é:

- intenção: `account_zero_balance`;
- moeda: `PYG`;
- conta: `Carteira PYG`;
- saldo usado: saldo calculado pelo domínio;
- cálculo: `calculateAmountToZero(-99)`;
- ajuste: adicionar `99`;
- saldo-alvo: `0`.

O teste unitário e o fluxo E2E impedem regressão para o antigo fallback `Não entendi com segurança`.

## Limitações atuais

A camada local não tenta ser um modelo de linguagem geral. Perguntas financeiras fora das intenções conhecidas ainda podem exigir esclarecimento. O próximo passo é ampliar a biblioteca de intenções e entidades por casos reais sem delegar cálculos financeiros ao modelo online.
