# Amigo Secreto

Piloto de amigo secreto para validar a stack do Pluto: InstantDB self-hosted (instantdb-rust), Svelte SPA, worker com OpenWorkflow, servidor MCP com Google e deploy em Dokku e Cloudflare Workers (arquivos estáticos). Tudo em Bun/TypeScript (Bun 1.4.5, nunca Node). A ideia, as telas e o registro de achados estão em `docs/ideias.md` (o §10 tem os achados e as respostas às 9 perguntas do piloto).

Em produção: front em https://amigo.tpou.gy (Worker `amigo-secreto`; reserva https://amigo-secreto.thomaz-pougy.workers.dev), MCP em https://amigo-mcp.app.tpou.gy/mcp, Instant em https://instant.tpou.gy.

## Onde está cada coisa

```
app/      front (SvelteKit SPA)            pacotes/  código compartilhado (dominio, instant)
worker/   worker Bun (OpenWorkflow)        infra/    provisionamento e deploy
mcp/      servidor MCP (Google)            scripts/  ferramentas do dia a dia
                                           docs/     documentação, specs e achados
```

Mapa das pastas, comandos do dia a dia, produção e segredos: **`docs/README.md`**.

## Fluxo

- O organizador cria o grupo e compartilha o código ou o QR; cada pessoa entra e preenche o perfil.
- **Sortear** cria um pedido em `sorteios`; o worker grava os pares e cada pessoa vê só quem tirou. São até 3 sorteios por abertura do grupo (o primeiro e até 2 refeitos).
- **Reabrir grupo para novos participantes** (aba Sorteio, com o grupo sorteado) cria uma `reaberturas`: o worker apaga os pares, volta o grupo para `aberto` e grava `rodadaBase`, o código volta a aceitar entradas, quem já estava no grupo vê "O sorteio foi desfeito…" e o organizador sorteia de novo (a contagem "rodada N de 3" recomeça).

## Rodar local

```bash
bun upgrade                        # Bun 1.4.5
infra/instant/instant-apps.sh      # cria/obtém os apps Instant e grava o .env (ver .env.example)
bun install
bun run test                       # todos os pacotes, em série
cd app && bun --bun svelte-check && bun --bun vite dev
```

Há dois apps Instant: `amigo-secreto` (produção) e `amigo-secreto-teste`; os testes só usam o de teste. Atenção: `app/.env.development` aponta para produção, então `vite dev` loga em produção. Deploy, painel, e2e e segredos: `docs/README.md`.
