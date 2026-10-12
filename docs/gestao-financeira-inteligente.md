# Gestão Financeira Inteligente

## Integração

A página `gestao-financeira.html` é uma nova área do Projeto Finanças e reutiliza o banco IndexedDB existente. Ela não cria uma segunda base de transações e não substitui os módulos de Contas, Diagnóstico ou Assistente.

- `js/financial-management-engine.js`: cálculos puros para resumo mensal, comparação entre períodos, categorias, suspeitas de duplicidade, projeção simples, riscos e simulações.
- `js/financial-management.js`: leitura do IndexedDB, renderização segura por `textContent`, filtros e formulários.
- `css/gestao-financeira.css`: layout responsivo com estados vazios e foco visível.
- `settings.financialManagementPlan`: guarda somente estado das ações, premissas de simulação e despesas futuras planejadas. Não guarda nem replica transações.
- `sw.js`: cache local da página e dos módulos para uso offline.
- `tests/financial-management-engine.vitest.js` e `tests/financial-management-db.vitest.js`: testes do motor e da persistência.
- `tests/e2e/financial-management.spec.js`: navegação e verificação de viewport de 320 px.

## Metodologia e limites

1. Transferências são excluídas dos totais de receitas e despesas.
2. BRL e PYG são apresentados separadamente nos totais. Os orçamentos usam o mecanismo de conversão já existente.
3. A comparação de categoria é entre o mês selecionado e o mês anterior completo.
4. A projeção do mês atual extrapola a média diária observada para os dias do mês; não prevê renda futura, sazonalidade ou despesas ainda não registradas.
5. Duplicidades são suspeitas por data, moeda, valor, descrição e categoria. Nenhum lançamento é excluído automaticamente.
6. Recorrências e anomalias são heurísticas sobre o histórico; devem ser confirmadas pelo usuário.
7. A renda comprometida é calculada por moeda como despesas divididas pelas receitas do período. Sem receita registrada, o indicador é indisponível.
8. A decisão usa média histórica somente quando existem registros em pelo menos dois meses; com histórico insuficiente, não oferece recomendação confiável. O sistema não classifica automaticamente despesas essenciais.
9. A lista de compromissos considera os registros ativos de `schedules`; suas frequências podem variar e não são automaticamente convertidas em valor mensal.
10. O plano de ação e despesas futuras são dados de planejamento. Criá-los, simular cenários ou mudar seu estado não cria, altera nem exclui transações.
11. O saldo disponível usa contas líquidas incluídas no orçamento; o patrimônio líquido considera contas marcadas para inclusão e sinaliza dívidas conforme os tipos existentes. BRL e PYG permanecem separados.
12. A área não chama provedores de IA nem envia dados para serviços externos.

## Testes

Executar no ambiente do projeto:

```bash
npm test
npm run test:coverage
npm run test:e2e
```

A publicação depende de CI verde e da verificação do GitHub Pages após o merge.
