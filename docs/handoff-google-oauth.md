# Handoff: Google OAuth, domínio e testes finais

Tudo o que falta para o piloto virar "pronto para gente de fora". Em ordem.

## 0. Conectar o GitHub ao Worker do front (primeiro, 2 minutos)

O front é o Worker de arquivos estáticos `amigo-secreto` (`wrangler.jsonc` na raiz), já no ar em https://amigo.tpou.gy (reserva: https://amigo-secreto.thomaz-pougy.workers.dev). O domínio e o DNS foram criados pelo próprio Worker. Falta ligar o deploy automático:

1. Painel da Cloudflare → Workers & Pages → `amigo-secreto` → Settings → Build → **Connect** → GitHub → repositório `tpougy/amigo-secreto` (autorize o app da Cloudflare só nesse repo).
2. Configuração do build:
   - Branch de produção: `main`
   - Diretório raiz: `/` (a raiz do repo; o app importa `instant.schema.ts` e `dominio/`)
   - Comando de build: `cd app && bun --bun vite build`
   - Comando de deploy: `bunx wrangler deploy`
   - Variável de build: `BUN_VERSION` = `1.4.5`
3. Salve e dispare um build (ou dê um push na `main`). Confira que termina verde e que o site continua no ar.

As variáveis `PUBLIC_*` do front vêm de `app/.env.production` (versionado; só valores públicos). Deploy manual, se precisar: `infra/front.sh`. As origens autorizadas do Instant já incluem `amigo.tpou.gy`, `amigo-secreto.thomaz-pougy.workers.dev` e `localhost:5173` (`infra/instant-origens.sh`).

## 1. Projeto no Google Cloud e tela de consentimento

1. Crie um projeto no Google Cloud (ou use um existente).
2. APIs e serviços, Tela de consentimento OAuth: tipo **Externo**, escopos `openid`, `email` e `profile`.
3. Links: política de privacidade `https://amigo.tpou.gy/privacidade` e termos `https://amigo.tpou.gy/termos`; domínio autorizado `tpou.gy`.
4. **Publique** a tela de consentimento (status "Em produção"). Em modo Testing o Google expira os refresh tokens em 7 dias, e o MCP perderia a sessão.

## 2. Client OAuth do app (login no site)

1. Credenciais, criar ID do cliente OAuth, tipo "Aplicativo da Web".
2. Origem JavaScript autorizada: `https://amigo.tpou.gy`.
3. URI de redirecionamento: `https://instant.tpou.gy/runtime/oauth/callback`.
4. Registre o client no Instant (o `app_id` é o `INSTANT_APP_ID` do `.env`):

```bash
ssh vps-mercurio 'instant-script create-oauth-client <app_id> google google <client_id> <client_secret> https://accounts.google.com/.well-known/openid-configuration amigo.tpou.gy'
```

## 3. Client OAuth do MCP

1. Crie um segundo client, tipo "Aplicativo da Web", com redirecionamento `https://amigo-mcp.app.tpou.gy/oauth/callback`.
2. Configure no Dokku (as credenciais hoje valem `pendente`):

```bash
ssh vps-mercurio 'dokku config:set amigo-mcp GOOGLE_CLIENT_ID=<id> GOOGLE_CLIENT_SECRET=<secret>'
```

O `config:set` reinicia o app. Confira `curl https://amigo-mcp.app.tpou.gy/health` (deve responder `ok`). O MCP já traz correções do fastmcp 4.28.4 em `mcp/google.ts` (e-mail da sessão e `access_type=offline`).

## 4. Ligar o Google no front

Em duas publicações, para nunca ficar sem login:

1. Em `app/.env.production` ponha `PUBLIC_LOGIN_GOOGLE=on` (mantendo o magic code ligado) e publique com um push na `main` (Workers Builds) ou `infra/front.sh`.
2. **Teste o login com Google de ponta a ponta** no site publicado (entrar, criar ou abrir um grupo, sair e entrar de novo), no computador e no celular. Só siga se funcionar.
3. Então ponha `PUBLIC_LOGIN_MAGIC=off` e publique de novo (push na `main` ou `infra/front.sh`). **Obrigatório antes de convidar gente de fora:** com `EMAIL_PROVIDER=log` o código mágico não chega a ninguém, só aparece no log do Instant, então para usuários reais o login por código não funciona (e só quem tem acesso à VPS conseguiria entrar por ele).

```bash
git push origin main   # ou: infra/front.sh
```

## 5. Testes que só você consegue fazer

- [ ] Login com Google no celular, no site publicado.
- [ ] MCP no claude.ai (conector `https://amigo-mcp.app.tpou.gy/mcp`): login Google, listar e usar as ferramentas como o seu usuário.
- [ ] MCP no ChatGPT, mesmo conector.
- [ ] Sessão do MCP depois de 8 dias (prova o refresh token com a tela publicada).
- [ ] Depois, registrar o resultado em `discussion/ideias.md` §10 e fechar as perguntas 6 e 8 ("em aberto") nas respostas do piloto.

## Enquanto isso

- Login por magic code: `bin/codigo-magico <email>` (ver README).
- Painel dos workflows: `bin/painel`.
