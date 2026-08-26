# Recuperação local de acesso

O Projeto Finanças utiliza proteção de acesso local, sem servidor de autenticação.

## Código de recuperação

Ao criar uma nova proteção, o aplicativo gera um código no formato `PF-XXXX-XXXX-XXXX-XXXX-XXXX`. O código é exibido uma única vez. O texto do código não é gravado no IndexedDB, LocalStorage, Service Worker, repositório ou backup financeiro.

No banco local de autenticação é armazenado apenas um verificador derivado com PBKDF2-SHA-256, salt aleatório e os parâmetros necessários para a validação.

Guarde o código fora do dispositivo, por exemplo em um gerenciador de senhas ou em uma cópia física segura.

## Esqueci minha senha/PIN

Na tela de login:

1. Clique em **Esqueci minha senha**.
2. Informe o nome de usuário.
3. Digite o código de recuperação.
4. Defina uma nova senha ou PIN.
5. Guarde o novo código de recuperação exibido.

Após uma recuperação bem-sucedida, o código anterior é invalidado e um novo código é gerado.

## Usuários que já tinham proteção antes deste recurso

Perfis criados antes da implementação da recuperação não possuem código antigo. Enquanto ainda souber a senha/PIN, abra **Configurações → Segurança e privacidade → Gerar novo código de recuperação** e guarde o código apresentado.

Se uma pessoa perder tanto a credencial quanto o código de recuperação, não existe recuperação por e-mail, SMS ou WhatsApp porque o projeto não possui backend de autenticação.

## Gerar um novo código

Em **Segurança e privacidade**, o usuário pode gerar um novo código informando a credencial atual. A operação invalida o código anterior.

## Limitação de segurança

Este mecanismo recupera o **bloqueio local de privacidade**. Ele não é autenticação de servidor e não significa que os dados financeiros do IndexedDB estejam criptografados em repouso. Uma futura criptografia dos dados exigirá um projeto de gerenciamento de chaves e recuperação diferente.
