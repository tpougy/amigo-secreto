# Handoff: Google OAuth, domínio e testes finais

Tudo o que falta para o piloto virar "pronto para gente de fora". Em ordem.

## 0. DNS do domínio próprio (primeiro, 1 minuto)

O front está no ar em https://amigo-secreto-hws.pages.dev. O domínio `amigo.tpou.gy` já está registrado no projeto do Pages, mas **pendente** ("CNAME record not set"; o token do wrangler não escreve na zona).

No Cloudflare, zona `tpou.gy`, crie: `CNAME  amigo  →  amigo-secreto-hws.pages.dev` (proxied pode). O Pages valida sozinho; rode `infra/pages.sh` de novo para ver o status. As origens autorizadas do Instant já incluem `amigo.tpou.gy`, `amigo-secreto-hws.pages.dev` e `localhost:5173` (`infra/instant-origens.sh`).

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

1. Em `app/.env.production` ponha `PUBLIC_LOGIN_GOOGLE=on` (mantendo o magic code ligado) e publique com `infra/pages.sh`.
2. **Teste o login com Google de ponta a ponta** no site publicado (entrar, criar ou abrir um grupo, sair e entrar de novo), no computador e no celular. Só siga se funcionar.
3. Então ponha `PUBLIC_LOGIN_MAGIC=off` e publique de novo com `infra/pages.sh`. **Obrigatório antes de convidar gente de fora:** com `EMAIL_PROVIDER=log` o código mágico não chega a ninguém, só aparece no log do Instant, então para usuários reais o login por código não funciona (e só quem tem acesso à VPS conseguiria entrar por ele).

```bash
infra/pages.sh
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
