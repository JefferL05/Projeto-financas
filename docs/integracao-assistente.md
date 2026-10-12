# Integração do assistente financeiro híbrido

## Decisão arquitetural

O repositório [celloweb-ai/Assistente_Financeiro](https://github.com/celloweb-ai/Assistente_Financeiro) é uma aplicação Python/Streamlit com módulos de chatbot, FAQs, calculadoras, análise de dados e persistência SQLite. Ele não pode ser importado diretamente para o frontend do Projeto Finanças, que é uma aplicação estática HTML/CSS/JavaScript, usa IndexedDB e precisa funcionar no GitHub Pages e offline.

Esta integração adapta o conceito de uma base de conhecimento/FAQ para JavaScript local, sem trazer Streamlit, SQLite, Pandas, LangChain ou dependências Python para o navegador.

## Fluxo

1. O assistente existente consulta o motor financeiro e o IndexedDB como antes.
2. Se a pergunta não corresponder a uma intenção financeira operacional, consulta `js/ai/financial-knowledge.js`.
3. Quando há correspondência suficiente, responde com conteúdo local e identificável; não envia a pergunta ou o histórico financeiro a terceiros.
4. Quando não há correspondência, o fluxo existente continua: resposta local de esclarecimento e, somente se a IA online estiver habilitada, houver consentimento e houver conexão, tentativa do backend configurado.
5. A IA online nunca deve ser usada para calcular ou substituir os valores numéricos produzidos pelo motor financeiro.

## Privacidade e segredos

- Nenhuma chave OpenAI/Gemini deve ser adicionada ao HTML, JavaScript, IndexedDB, LocalStorage, Service Worker ou Git.
- A integração não adiciona chamadas externas nem novas dependências.
- O endpoint online precisa ser um backend HTTPS separado, com segredo configurado no ambiente do servidor, autenticação/limites de uso, validação de entrada e saída, política de CORS restrita e limites de tamanho/tempo.
- A configuração de consentimento existente continua sendo a fonte de autorização para IA online.
- O modo local não depende de internet; o novo módulo foi incluído no app shell do Service Worker.

## Proveniência e licença

O repositório de referência declara licença MIT. Esta integração usa-o como referência de funcionalidades e arquitetura; a base de conhecimento JavaScript foi escrita para este projeto e não copia a implementação Python/Streamlit. Se futuramente forem incorporados trechos de código desse repositório, preservar o aviso de copyright e a licença MIT conforme exigido.

## Testes

O arquivo `tests/financial-knowledge.vitest.js` cobre respostas para privacidade, modo offline, transferências e custo da IA; retorno nulo quando não há correspondência segura; e entradas vazias ou compostas apenas por palavras comuns.

Executar com:

```bash
npm install
npm test
npm run test:coverage
npm run test:e2e
```

O merge só deve ocorrer após CI verde e revisão da integração com o restante do assistente.
