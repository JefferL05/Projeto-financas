# Evolução gradual da arquitetura

## Restrições preservadas
- JavaScript nativo com ES Modules; sem framework ou etapa de build.
- Hospedagem estática no GitHub Pages, inclusive em subcaminho de projeto.
- IndexedDB continua sendo a fonte local dos dados financeiros.
- Cada etapa deve ser pequena, revisável e acompanhada de testes.

## Etapa 1 — infraestrutura compartilhada
- Centralizar seletores DOM em `js/dom.js`.
- Manter os três pontos de entrada existentes (`js/app.js`, `js/gestao.js`, `js/inteligencia.js`) e seus HTMLs.
- Não alterar regras de negócio nem o esquema do IndexedDB.

## Próximas etapas propostas
1. Extrair renderização e navegação de `js/app.js` para módulos de UI, preservando contratos e IDs do HTML.
2. Separar operações de transação/importação/exportação do controlador principal.
3. Dividir `js/gestao.js` por contas, transferências, conciliação e compromissos.
4. Dividir `js/inteligencia.js` por chat/ações, metas, orçamentos e privacidade.
5. Para cada etapa: testes unitários, E2E, inspeção dos imports relativos e validação no GitHub Pages.

## Regras de segurança da refatoração
- Não renomear IDs de DOM nem alterar estruturas de dados sem testes e migração explícita.
- Não introduzir dependências runtime, bundlers, aliases de import ou caminhos absolutos.
- Não apagar nem recriar dados locais durante inicialização.
- Fazer merge apenas após CI aprovado e revisão do diff.
