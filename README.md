# FLASHX Central de Aplicativos — GitHub, Neon e Render

Projeto web responsivo para o catálogo de aplicativos FLASHX, com acesso por usuário e senha, PostgreSQL Neon e painel de gerenciamento. Para permitir que o código fique público sem publicar os links e códigos dos aplicativos, a lista inicial está fora do projeto-fonte e deve ser importada no painel depois do deploy.

## Acessos

- `/login`: entrada no catálogo com `SITE_USERNAME` e `SITE_PASSWORD`.
- `/admin/login`: entrada do administrador com `ADMIN_USERNAME` e `ADMIN_PASSWORD`.
- `/admin`: cadastrar, editar, ocultar, reordenar e apagar aplicativos no banco Neon.
- `/healthz`: verificação técnica usada pelo Render.

Os usuários do catálogo não podem administrar os aplicativos. Use senhas diferentes para clientes e administrador.

## Privacidade importante

- O código-fonte pode ficar em um repositório público; os segredos de acesso e a connection string ficam nas variáveis de ambiente do Render.
- A lista com links, códigos e informações dos dez aplicativos é entregue separadamente em um arquivo JSON privado. **Não coloque esse arquivo em um repositório público.** Importe-o pelo painel administrativo após o deploy; os dados ficam no Neon.
- Se uma versão anterior do projeto com `seed-apps.json` preenchido já foi enviada ao GitHub, esse conteúdo pode continuar no histórico de commits. Para publicar com segurança, prefira criar um repositório público novo usando este ZIP corrigido, sem importar o histórico antigo.
- O Render hospeda um serviço web público, mas as páginas do catálogo e do painel exigem login. Os arquivos de ícone são estáticos e não contêm códigos nem links de download.

## 1. Enviar o código ao GitHub

Crie um repositório público chamado, por exemplo, `flashx-apps`, e envie para a raiz do repositório todo o conteúdo desta pasta: `render.yaml`, `package.json`, `server.js`, `seed-apps.json`, `public/` e os demais arquivos. `seed-apps.json` deve continuar vazio (`[]`). Não envie o arquivo de importação privado nem um `.env`.

O `.gitignore` exclui `.env`, `node_modules` e logs. Não remova essa proteção.

Com Git instalado, dentro desta pasta:

```sh
git init
git add .
git commit -m "Criar catálogo FLASHX protegido por login"
git branch -M main
git remote add origin URL_DO_SEU_REPOSITORIO
git push -u origin main
```

Troque `URL_DO_SEU_REPOSITORIO` pelo endereço que o GitHub mostrar. Se sua branch se chamar `principal`, selecione `principal` no Render.

## 2. Criar o banco Neon

1. Crie um projeto PostgreSQL no Neon.
2. Clique em **Connect** e selecione branch, banco e usuário.
3. Copie a connection string, de preferência a conexão pooled com TLS.
4. Guarde-a como `DATABASE_URL` nas variáveis do Render. Não a envie ao GitHub nem ao chat.

Na primeira inicialização, o servidor cria as tabelas de aplicativos e sessões. Não há aplicativos no banco até a importação do arquivo privado.

## 3. Configurar e publicar no Render

1. Conecte o GitHub ao Render e selecione o repositório.
2. Escolha **New > Blueprint**, selecione a branch que contém o `render.yaml` e revise as configurações.
3. Preencha as variáveis de ambiente secretas:

| Variável | Valor |
|---|---|
| `DATABASE_URL` | Connection string do Neon |
| `SITE_USERNAME` | Usuário que os clientes usarão |
| `SITE_PASSWORD` | Senha do catálogo, pelo menos 12 caracteres |
| `ADMIN_USERNAME` | Usuário administrativo separado |
| `ADMIN_PASSWORD` | Senha administrativa diferente, pelo menos 12 caracteres |
| `SESSION_SECRET` | Valor aleatório exclusivo de pelo menos 32 caracteres |

`NODE_ENV=production`, o comando de build (`npm install`) e o comando de início (`npm start`) já estão no Blueprint. Não coloque os valores secretos em arquivos do GitHub.

Depois que o serviço estiver ativo, acesse `/admin/login`, entre com as credenciais administrativas e importe os aplicativos:

1. Abra o arquivo JSON privado que foi entregue separadamente.
2. Copie todo o conteúdo do arquivo.
3. Na página `/admin`, cole o JSON no campo **Importar catálogo privado** e clique **Importar/atualizar catálogo**.
4. Saia do painel e teste o acesso do catálogo usando `SITE_USERNAME` e `SITE_PASSWORD`.

A importação grava os dados no Neon, não no GitHub. Se importar novamente, os aplicativos com o mesmo slug serão atualizados.

O serviço está configurado no plano gratuito do Render, que pode suspender após inatividade.

## Rodar localmente no Windows

Requisitos: Node.js 20 ou superior e uma base PostgreSQL.

1. Copie `.env.example` para `.env` e preencha as seis variáveis listadas acima.
2. Execute `npm install` e depois `npm start` no terminal aberto nesta pasta.
3. Abra `http://localhost:3000/admin/login`, entre como administrador e importe o JSON privado. O catálogo fica em `http://localhost:3000/login`.

Nunca envie `.env` nem o JSON privado ao GitHub.

## Ícones

Os ícones públicos ficam em `public/assets/`. Para trocar um, adicione a nova imagem nessa pasta e atualize o campo de ícone no painel com o caminho `/assets/nome-do-arquivo.jpg` ou uma URL HTTPS.

## Status

Este é o projeto-fonte. Ainda precisa ser enviado ao GitHub e conectado às contas Neon e Render; não foi publicado nem testado com um banco Neon real.
