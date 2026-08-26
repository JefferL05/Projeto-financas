# Proteção de acesso local

O Projeto Finanças possui uma camada de **bloqueio local de privacidade**. Ela não é autenticação de servidor e não deve ser tratada como equivalente a login com backend.

## Como funciona

- A credencial nunca é salva em texto puro.
- A verificação usa Web Crypto API com PBKDF2 + SHA-256, salt aleatório e 210.000 iterações.
- O perfil de acesso fica em um IndexedDB separado: `ProjetoFinancasAuthDB`.
- O banco financeiro principal continua em `ProjetoFinancasDB` e não é migrado por causa do login.
- O backup financeiro não inclui senha, PIN, verifier ou material de sessão.
- A sessão desbloqueada usa apenas `sessionStorage` e não contém a senha/PIN.
- Ao fechar a sessão do navegador/PWA, o acesso deve ser solicitado novamente.
- O bloqueio automático pode ser configurado para nunca, 1, 5, 15 ou 30 minutos.

## Limitação importante

Os registros financeiros no IndexedDB **não são criptografados em repouso por esta funcionalidade**. O recurso impede acesso casual pela interface do aplicativo, mas alguém com acesso ao perfil do navegador e ferramentas de desenvolvimento ainda pode inspecionar o armazenamento local.

Criptografia completa do banco é uma fase separada e exige projeto de migração próprio.

## Recuperação

Não existe recuperação por e-mail, SMS, WhatsApp ou link mágico porque o projeto não possui servidor de autenticação. Nenhuma dessas opções deve ser simulada.

## PWA e offline

Os arquivos da tela de acesso e os módulos de autenticação fazem parte do app shell do Service Worker. A validação da credencial funciona sem internet.

A rota opcional de IA online continua fora do cache do Service Worker.

## Arquitetura

```text
js/auth/
├── entry.js          # guard compartilhado das páginas financeiras
├── auth-ui.js        # UI de criação/login/configurações
├── auth-service.js   # persistência e regras de credenciais
├── crypto-service.js # PBKDF2/Web Crypto
└── session.js        # sessão temporária e auto-lock
```

O guard é inicializado antes dos controladores financeiros por meio de `js/utils.js`. Ele intercepta a inicialização até o desbloqueio e mantém os shells financeiros ocultos durante a tela de acesso.

## Segurança futura

WebAuthn/Passkeys é a evolução indicada para autenticação com o mecanismo seguro do dispositivo. Não há biometria simulada em JavaScript.