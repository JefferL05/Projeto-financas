# Projeto Finanças 🇵🇾 🇧🇷

Aplicação web de gestão financeira pessoal multi-moeda, local-first, construída com HTML, CSS e JavaScript ES Modules. O projeto funciona sem backend obrigatório, persiste dados em IndexedDB e é compatível com GitHub Pages/PWA.

## Stack

- HTML5
- CSS3
- JavaScript ES Modules
- IndexedDB
- Chart.js com fallback Canvas local
- Service Worker + Web App Manifest
- Vitest + fake-indexeddb para testes unitários
- Playwright para fluxos E2E críticos
- GitHub Actions para CI

## Funcionalidades atuais

- Entradas e saídas em BRL e PYG
- Contas manuais em BRL/PYG
- Ativos e passivos
- Cartão de crédito e empréstimos manuais
- Transferências atômicas entre contas
- Conciliação manual
- Categorias e tags
- Importação rápida de texto
- Importação/exportação CSV
- Backup/restauração JSON completo
- Metas financeiras
- Orçamentos por categoria
- Agendamentos e compromissos
- Parcelamentos por agenda
- Regras locais de categorização
- Relatórios e analytics
- Histórico/captura de cotação BRL → PYG
- Assistente financeiro local
- IA online opcional por backend seguro
- PWA/offline

## Arquitetura

```text
UI
├── index.html          Dashboard, transações, dados e configurações
├── gestao.html        Contas, transferências, conciliação e compromissos
└── inteligencia.html  Assistente, metas, orçamentos e planejamento

Controladores
├── js/app.js
├── js/gestao.js
└── js/inteligencia.js

Domínio
├── js/accounts/
├── js/ai/
├── js/data/
├── js/finance/
├── js/reports/
├── js/rules/
└── js/transactions/

Persistência
└── js/db.js → IndexedDB
```

Os cálculos financeiros permanecem determinísticos e locais. A IA online, quando habilitada, apenas explica contexto previamente calculado e nunca deve recalcular ou substituir números do motor financeiro.

## IndexedDB

Banco: `ProjetoFinancasDB`

Versão atual: **6**

Stores:

- `transactions`
- `settings`
- `categories`
- `exchangeRates`
- `goals`
- `budgets`
- `accounts`
- `schedules`
- `rules`
- `reconciliations`

### Índices relevantes

Transações possuem índices por data, moeda, tipo, categoria, conta, status, transferência e agendamento. Contas, agendamentos, regras e conciliações também possuem índices específicos usados pelos serviços de domínio.

## Reset seguro

A limpeza total do banco é uma operação de domínio atômica. Depois do reset são recriados automaticamente:

- `Carteira BRL`
- `Carteira PYG`
- categorias padrão
- `baseCurrency = PYG`
- `brlToPyg = 1300`
- cotação inicial de referência

O reset pode ser executado novamente sem duplicar os defaults.

## Valores e moedas

`parseLooseNumber()` preserva sinal quando ele existe.

- transações, transferências e agendas continuam exigindo valor positivo;
- saldo inicial e conciliação podem usar valores assinados;
- BRL aceita formatos como `1.234,56`;
- PYG aceita valores inteiros com separador de milhar;
- formato `1,234.56` pode ser interpretado com `localeHint: "en-US"`.

A exportação CSV neutraliza valores iniciados por `=`, `+`, `-` ou `@` para reduzir risco de CSV Formula Injection em planilhas.

## Contas e patrimônio

A aplicação diferencia ativos e passivos.

### Ativos

- receita aumenta saldo;
- despesa reduz saldo;
- transferência recebida aumenta saldo;
- transferência enviada reduz saldo.

### Passivos

- compra/despesa aumenta dívida;
- pagamento reduz dívida;
- passivos são descontados do patrimônio líquido.

Transferências usam duas movimentações ligadas por `transferId` e são gravadas na mesma transação IndexedDB. Elas não entram como receita ou despesa nos relatórios.

## Backup

Schema atual: **6**

```json
{
  "schemaVersion": 6,
  "appVersion": "2.0.0",
  "dbVersion": 6,
  "exportedAt": "...",
  "stores": {}
}
```

O backup inclui todas as stores conhecidas. Backups legados sem contas são migrados antes da restauração e as transações são vinculadas a carteiras padrão compatíveis com a moeda.

Settings importados são validados por allowlist:

- `baseCurrency`: `BRL` ou `PYG`;
- `brlToPyg`: número finito e positivo dentro do intervalo aceito.

## Assistente financeiro

Fluxo:

1. IndexedDB fornece dados validados.
2. O motor financeiro calcula as métricas.
3. O roteador de intenções interpreta a pergunta.
4. O motor local produz resposta estruturada.
5. A IA online é usada somente se estiver habilitada e houver consentimento.
6. Em falha de rede/backend, o assistente volta ao modo local.

Nenhuma chave de API deve ser colocada no HTML, JavaScript, IndexedDB, LocalStorage, Service Worker ou repositório.

O frontend espera um backend separado em:

```http
POST /api/financial-assistant
```

GitHub Pages não executa esse backend.

## Privacidade

Padrão: **Somente análise local**.

1. Somente análise local.
2. IA online com dados agregados.
3. IA online com detalhes selecionados.

A memória de conversa usa `sessionStorage` e não entra no backup financeiro.

## PWA / offline

O Service Worker usa cache versionado e mantém o app shell local. Não são armazenados em cache `/api/*`, respostas da IA online ou recursos externos privados.

Chart.js é carregado por CDN quando disponível, mas `js/charts.js` possui fallback Canvas local para os gráficos essenciais. A vendorização de Chart.js permanece uma melhoria futura.

O manifest possui `start_url`, `scope`, modo standalone, tema, atalhos e ícones próprios 192x192/512x512. Os ícones atuais são SVG e ficam no app shell offline.

## Segurança

- validação de stores/IDs/moedas/tipos/status/datas/valores;
- settings por allowlist;
- restauração multi-store atômica;
- limite de tamanho em backup/importações;
- DOM preferencialmente com `createElement`, `textContent`, `replaceChildren` e `addEventListener`;
- sem `eval()`/`Function()` no motor de regras;
- proteção contra CSV Formula Injection;
- CSP nas páginas principais;
- IA online sem chave no cliente;
- `/api/*` excluído do cache PWA.

## Testes

```bash
npm install
npm test
npm run test:coverage
npm run test:e2e
```

A suíte unitária utiliza somente dados fictícios e cobre cálculos financeiros, BRL/PYG, comparação de períodos, contas/passivos, parser/importação rápida, recorrências/anomalias, metas/orçamentos, reset, settings, valores negativos, backup, XSS/prompt injection e CSV Formula Injection.

A suíte Playwright cobre sete fluxos críticos:

1. criar transação e atualizar dashboard;
2. importação rápida;
3. criar conta e transferir entre contas;
4. compra e pagamento parcial de cartão;
5. exportar, limpar e restaurar backup;
6. navegação local offline;
7. assistente financeiro local sem IA externa.

O CI está em `.github/workflows/tests.yml` e executa Vitest, cobertura e Playwright.

## Executar localmente

```bash
python -m http.server 8080
```

Abra `http://localhost:8080`.

## GitHub Pages

Produção atual:

```text
https://jefferl05.github.io/Projeto-financas/
```

## Limitações e próximos passos

- `js/app.js`, `js/gestao.js` e `js/inteligencia.js` ainda devem ser divididos gradualmente em módulos menores;
- algumas telas ainda usam `getAll()` e podem evoluir para consultas indexadas/paginadas;
- Chart.js ainda não está vendorizado localmente;
- a cobertura unitária dos controladores/UI ainda é baixa, compensada parcialmente pelos E2E;
- faltam fixtures automatizadas completas de migração v3/v4/v5 → v6;
- IA generativa exige backend separado e continua opcional;
- não existe integração bancária/Open Finance real.

Consulte também `docs/CODE_REVIEW.md` para o histórico de revisão técnica.
