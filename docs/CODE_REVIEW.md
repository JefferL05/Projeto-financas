# Revisão técnica — Projeto Finanças

Data da revisão: 25/08/2026

## Escopo

Revisão transversal da aplicação local-first, cobrindo principalmente:

- entrada e importação de transações;
- IndexedDB e migrações;
- contas, passivos e patrimônio;
- transferências;
- backup/restauração;
- IA local/online opcional;
- segurança do DOM;
- PWA e Service Worker;
- testes automatizados.

## Problemas críticos corrigidos

### 1. Parser acoplado ao DOM e ao banco

`js/parser.js` registrava um listener global em `document`, interceptava `#importSmartBtn` em fase de captura e chamava `stopImmediatePropagation()`. Ao mesmo tempo, `js/app.js` possuía o fluxo oficial de importação para o mesmo botão.

Consequências:

- dois donos para o mesmo evento;
- ordem de execução difícil de prever;
- importação rápida podendo deixar de executar o fluxo principal;
- parser com responsabilidades de UI, persistência e criação de contas.

Correção:

- `parser.js` voltou a ser módulo puro;
- persistência fica na camada de aplicação;
- removido listener global;
- adicionados testes específicos do parser;
- números dentro de marcação HTML não criam lançamentos falsos.

### 2. Contas de passivo com direção de saldo incorreta

Cartões, empréstimos e outras dívidas usavam a mesma regra de sinal das contas de ativo.

Exemplo incorreto anterior:

- compra de R$ 50 em um cartão reduzia a dívida;
- pagamento do cartão por transferência aumentava a dívida.

Correção:

- regras de movimento agora consideram o tipo da conta;
- despesa aumenta passivo;
- pagamento/entrada de recursos no passivo reduz a dívida;
- patrimônio líquido continua tratando passivos com sinal negativo;
- adicionados testes para cartão e patrimônio.

### 3. Backup legado podia deixar o banco inconsistente

Ao restaurar um backup antigo sem a store `accounts` em modo `replace`, as contas atuais podiam ser apagadas e as transações restauradas sem `accountId`.

Correção:

- backups legados recebem carteiras determinísticas BRL/PYG;
- transações sem conta são vinculadas à carteira correspondente;
- status ausente é normalizado;
- migração permanece idempotente e ocorre antes da validação/gravação atômica.

### 4. Consulta de transferências fazia varredura completa

`getTransferParts()` carregava todas as transações com `getAll()` e filtrava em memória, apesar de existir índice `transferId`.

Correção:

- consulta agora utiliza o índice `transferId` do IndexedDB;
- validação da integridade das duas partes foi centralizada;
- edição, exclusão e restauração reutilizam a mesma regra.

## Segurança revisada

### DOM / XSS

As interfaces principais usam `createElement`, `textContent`, `replaceChildren` e `addEventListener` para dados controlados pelo usuário. Não foram encontrados usos ativos de `eval()` ou `Function()` no motor de regras.

O parser trata conteúdo semelhante a HTML como dado. A camada IndexedDB também normaliza textos antes de persistir.

### IA

- nenhuma chave de API fica no cliente;
- IA online continua opcional;
- chamadas usam `credentials: omit` e `cache: no-store`;
- existe timeout e abort;
- o Service Worker exclui `/api/*` do cache;
- respostas são renderizadas com `textContent`.

### Backup

- limite de tamanho do arquivo;
- limite por store;
- registros normalizados antes da gravação;
- restauração multi-store atômica;
- suporte a merge/replace.

## PWA

O cache foi atualizado para a versão 8 e agora inclui módulos essenciais que haviam ficado fora do app shell, inclusive `js/ai/account-context.js`.

A instalação do Service Worker falha quando recursos críticos não podem ser pré-carregados, em vez de instalar silenciosamente um shell incompleto. Recursos opcionais podem falhar sem derrubar toda a instalação.

Rotas de API e recursos externos não são armazenados no cache privado da aplicação.

## Testes

A suíte automatizada utiliza Vitest + fake-indexeddb e roda no GitHub Actions.

Cobertura adicionada nesta revisão:

- parser PYG;
- parser BRL;
- troca de moeda por cabeçalho;
- conteúdo HTML como dado;
- entrada inválida;
- compra em cartão aumenta dívida;
- pagamento de cartão reduz dívida;
- passivo reduz patrimônio.

O workflow mais recente após as correções terminou com sucesso.

## Débitos técnicos restantes

Estes pontos não bloqueiam o funcionamento atual, mas devem ser tratados em etapas pequenas e testadas.

### Alto

1. **Reset completo do banco**
   `clearDatabaseData()` limpa também as contas padrão. A camada de inicialização atual não recria as carteiras após um reset na mesma versão do IndexedDB. O reset deve ser transformado em operação de domínio que limpe os dados e semeie defaults atomicamente.

2. **Valores negativos em contas/passivos**
   `parseLooseNumber()` foi originalmente pensado para valores de transação positivos e remove o sinal inicial. Campos como saldo inicial e saldo de conciliação precisam de um parser explícito com `allowNegative`.

3. **`app.js` grande demais**
   O arquivo principal ainda reúne estado, navegação, persistência, formulários, renderização, importação, dashboard e configuração. Deve ser dividido gradualmente em `app/state`, `transactions`, `data` e `ui`, mantendo a aplicação sem build obrigatório.

### Médio

4. **Uso excessivo de `getAll()`**
   Algumas telas ainda carregam stores completas. Já existem índices e `queryIndex()`, mas devem ser usados em filtros/paginação conforme a base crescer.

5. **Chart.js externo**
   Existe fallback local de gráficos, mas Chart.js ainda é carregado de CDN quando online. Para paridade total offline, considerar versão vendorizada e fixa com licença documentada.

6. **Manifest sem ícones finais**
   O PWA possui `start_url`, `scope` e modo standalone, mas ainda precisa de ícones próprios em tamanhos adequados para melhor instalabilidade.

7. **Validação específica de settings**
   A chave de configuração é validada, mas valores como moeda-base e cotação merecem schemas explícitos na restauração/importação.

8. **Testes E2E**
   Há boa base de testes unitários, porém faltam fluxos de navegador com Playwright para importação rápida, restauração, PWA e diálogos.

## Diretrizes para próximas refatorações

- uma responsabilidade por módulo;
- funções puras para cálculos financeiros;
- IndexedDB atrás de serviços de domínio;
- nenhuma regra de persistência dentro de parsers/renderers;
- nenhuma interpolação de conteúdo do usuário em HTML executável;
- operações multi-registro sempre atômicas;
- cada correção acompanhada de teste de regressão;
- commits pequenos e verificáveis;
- manter compatibilidade com GitHub Pages e funcionamento sem IA online.
