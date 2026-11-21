# Onde está cada coisa

Os `docs/superpowers/specs` e `plans` são registros datados e podem citar caminhos antigos; vale o mapa abaixo.

## Mapa

| Pasta | O que tem | Quando mexer |
|---|---|---|
| `app/` | SPA SvelteKit (`@instantdb/svelte`), publicada no Worker `amigo-secreto` | Telas e fluxos do site |
| `worker/` | Worker do OpenWorkflow: sorteio, reabertura e exclusão de conta (`amigo-worker`) | Regras que rodam no servidor |
| `mcp/` | Servidor MCP (fastmcp + Google) que age como o usuário logado (`amigo-mcp`) | Ferramentas do assistente de IA |
| `pacotes/instant/` | Schema, regras e testes de permissão (fonte da verdade do Instant) | Mudar dados ou regras |
| `pacotes/dominio/` | Lógica pura: código do grupo, sorteio, campos de perfil, temas | Regras de negócio sem I/O |
| `infra/dokku/` | `provisionar.sh` e `deploy.sh` dos apps `amigo-*` | Criar ou publicar apps na VPS |
| `infra/instant/` | Apps, schema/regras, origens e Google OAuth do Instant | Mudar o Instant |
| `infra/painel/` | Dockerfile e config do painel do OpenWorkflow (`amigo-painel`) | Raramente |
| `infra/front.sh` | Deploy manual do front | Se o Workers Builds falhar |
| `scripts/` | Operação: `painel`, `codigo-magico`, `e2e-producao.ts`, `colisao-codigos.ts`, `seed/` | Dia a dia |
| `docs/` | Esta pasta, `ideias.md`, handoff do Google, spikes e `superpowers/` (specs e planos) | Documentação |
| `wrangler.jsonc` (raiz) | Config do Worker do front; o Workers Builds usa a raiz | Quase nunca |

## Fluxos do dia a dia

Tudo a partir da raiz. O `.env` fica só na raiz (modelo em `.env.example`).

```bash
# Rodar local (atenção: app/.env.development aponta para o app de produção)
bun install
cd app && bun --bun svelte-check && bun --bun vite dev

# Testar (todos os pacotes, em série; usam o app Instant de teste)
bun run test

# Front: push na main publica sozinho (Workers Builds). Manual:
infra/front.sh

# Worker, MCP ou painel
infra/dokku/deploy.sh <amigo-worker|amigo-mcp|amigo-painel>
infra/dokku/provisionar.sh        # cria os apps (idempotente)

# Schema ou regras: primeiro teste, depois prod
infra/instant/instant-push.sh teste
infra/instant/instant-push.sh prod
infra/instant/instant-origens.sh  # origens autorizadas do OAuth

# Painel do OpenWorkflow (túnel SSH, http://localhost:3999)
scripts/painel

# E2E em produção (limpa o que cria)
bun scripts/e2e-producao.ts

# Seed (padrão: app de teste)
bun scripts/seed/seed.ts scripts/seed/exemplo.json [--app teste|prod]

# Google OAuth (site e MCP a partir dos JSONs do Google)
infra/instant/google-oauth.sh

# Código mágico (só em desenvolvimento; em produção o login é só Google)
scripts/codigo-magico <email>
```

Logs do worker: `ssh vps-mercurio 'dokku logs amigo-worker --num 100'`. Passos do Google: `docs/handoff-google-oauth.md`.

## Produção

- Front: https://amigo.tpou.gy (Worker `amigo-secreto`, deploy por push na `main`; reserva https://amigo-secreto.thomaz-pougy.workers.dev).
- MCP: https://amigo-mcp.app.tpou.gy/mcp
- Instant: https://instant.tpou.gy
- Dokku (VPS `vps-mercurio`): `amigo-worker`, `amigo-mcp`, `amigo-painel` (só em `127.0.0.1:3999`, via `scripts/painel`).
- Login só com Google (`PUBLIC_LOGIN_MAGIC=off`).

## Segredos e onde guardá-los

Nenhum valor mora no repositório. O `.env` local não vai para o git.

| Segredo | Onde vive hoje | Guardar |
|---|---|---|
| Admin token do Instant, produção | `/root/instant-apps/amigo-secreto.env` na VPS e `.env` local | Bitwarden (obrigatório) |
| Admin token do Instant, teste | `/root/instant-apps/amigo-secreto-teste.env` na VPS e `.env` local | Bitwarden (obrigatório) |
| Google OAuth do site (client ID e secret) | Registrado no Instant (app de produção) | Bitwarden (obrigatório) |
| Google OAuth do MCP (client ID e secret) | `dokku config` do `amigo-mcp` | Bitwarden (obrigatório) |
| `app_id` do Instant | `.env` e `app/.env.production` | Público; anote junto dos tokens |
| `SORTEIO_SEGREDO` | `dokku config` do `amigo-worker` | Opcional (perder só impede reproduzir sorteios antigos) |
| `MCP_ENCRYPTION_KEY`, `MCP_JWT_KEY` | `dokku config` do `amigo-mcp` | Opcional (perder obriga usuários do MCP a reconectar) |
| Token da API do Workers Builds, login do wrangler | Cloudflare / máquina local | Não precisa (recriáveis) |

Consultar os tokens do Instant na VPS (Thomaz):

```bash
ssh vps-mercurio 'cat /root/instant-apps/amigo-secreto.env /root/instant-apps/amigo-secreto-teste.env; echo'
```
