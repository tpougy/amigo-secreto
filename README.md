# Amigo Secreto

Piloto de amigo secreto para validar a stack do Pluto: InstantDB self-hosted (instantdb-rust), Svelte SPA, worker com OpenWorkflow, servidor MCP com Google e deploy em Dokku e Cloudflare Pages. Tudo em Bun/TypeScript (Bun 1.4.5, nunca Node). A ideia, as telas e o registro de achados estão em `discussion/ideias.md` (o §10 tem os achados e as respostas às 9 perguntas do piloto).

Em produção: front em https://amigo-secreto-hws.pages.dev (o domínio `amigo.tpou.gy` depende do CNAME descrito em `docs/handoff-google-oauth.md`), MCP em https://amigo-mcp.app.tpou.gy, Instant em https://instant.tpou.gy.

## Estrutura

| Pasta | O que é |
|---|---|
| `instant.schema.ts`, `instant.perms.ts` | Schema e regras de permissão do Instant (fonte da verdade) |
| `dominio/` | Lógica pura: código do grupo, sorteio, campos de perfil, validação de respostas |
| `worker/` | Assina `sorteios`, `pedidosExclusao` e `reaberturas` no Instant e roda os workflows (OpenWorkflow) |
| `painel/` | Painel do OpenWorkflow (só em `127.0.0.1:3999` na VPS) |
| `mcp/` | Servidor MCP (fastmcp + Google) que age como o usuário logado |
| `ingestao/` | Seed idempotente de grupos a partir de JSON |
| `app/` | SPA SvelteKit (`@instantdb/svelte`), publicada no Cloudflare Pages |
| `testes/` | Permissões (`asUser`), colisão de códigos e o e2e de produção |
| `infra/`, `bin/` | Scripts de infraestrutura e de operação |

## Fluxo

- O organizador cria o grupo e compartilha o código ou o QR; cada pessoa entra e preenche o perfil.
- **Sortear** cria um pedido em `sorteios`; o worker grava os pares e cada pessoa vê só quem tirou. São até 3 sorteios por abertura do grupo (o primeiro e até 2 refeitos).
- **Reabrir grupo para novos participantes** (aba Sorteio, com o grupo sorteado) cria uma `reaberturas`: o worker apaga os pares, volta o grupo para `aberto` e grava `rodadaBase`, o código volta a aceitar entradas, quem já estava no grupo vê "O sorteio foi desfeito…" e o organizador sorteia de novo (a contagem "rodada N de 3" recomeça).

## Rodar local

```bash
bun upgrade                # Bun 1.4.5
infra/instant-apps.sh      # cria/obtém os apps Instant e grava o .env (ver .env.example)
bun install
bun run test               # todos os pacotes, em série (usam o mesmo app Instant de teste)
cd app && bun --bun svelte-check && bun --bun vite dev
```

Há dois apps Instant: `amigo-secreto` (produção) e `amigo-secreto-teste`. Os testes só usam o de teste. O `.env` fica fora do git. Atenção: `app/.env.development` aponta para o app de produção, então `vite dev` loga em produção.

Use `bun run test` (roda um pacote de cada vez); o `bun test` puro da raiz também passa, mas roda tudo num processo só.

## Deploy

```bash
infra/instant-push.sh <prod|teste>   # schema e permissões
infra/provisionar.sh                 # apps Dokku amigo-worker, amigo-painel e amigo-mcp (idempotente)
infra/deploy.sh <amigo-worker|amigo-painel|amigo-mcp>
infra/instant-origens.sh             # origens autorizadas do OAuth no Instant
infra/pages.sh                       # build do app e deploy no Cloudflare Pages
bun testes/e2e-producao.ts           # verificação em produção (limpa o que cria)
```

## Operação

- **Painel do OpenWorkflow:** `bin/painel` abre um túnel SSH e o navegador em http://localhost:3999.
- **Logs:** `ssh vps-mercurio 'dokku logs amigo-worker --num 100'` (só ids, contagens e nomes de passo; nunca dados de pessoas).
- **Login por magic code enquanto o Google não está configurado:** o Instant está com `EMAIL_PROVIDER=log`, então nenhum e-mail é enviado. Peça o código na tela de login e rode `bin/codigo-magico <email>` (lê o log do Instant na VPS e imprime só o código). Equivale a `ssh vps-mercurio 'dokku logs instant --num 100' | grep -i -A2 <email>`.
- **Login com Google e MCP:** pendentes; passos em `docs/handoff-google-oauth.md`.
