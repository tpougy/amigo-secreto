# Reorganização do repositório — design

**Data:** 2026-11-21 · **Status:** aprovado (Thomaz)

## Intenção
Deixar o alto nível do repositório enxuto. Os três produtos (`app/`, `worker/`, `mcp/`) ficam onde estão, e todo o resto passa a viver em `pacotes/`, `infra/`, `scripts/` e `docs/`. Uma documentação de mapa explica onde está cada coisa. O comportamento em produção **não muda**.

## Estrutura alvo

| Hoje | Depois |
|---|---|
| `dominio/` | `pacotes/dominio/` (`@amigo/dominio`) |
| `instant.schema.ts`, `instant.perms.ts` | `pacotes/instant/schema.ts`, `pacotes/instant/perms.ts` (pacote `@amigo/instant`) |
| `testes/permissoes.*.test.ts`, `testes/instant-teste.ts` | `pacotes/instant/testes/` (o kit vira `@amigo/instant/teste`) |
| `testes/e2e-producao.ts`, `testes/colisao-codigos.ts` | `scripts/` |
| `ingestao/` | `scripts/seed/` (`@amigo/seed`) |
| `bin/painel`, `bin/codigo-magico` | `scripts/painel`, `scripts/codigo-magico` |
| `infra/provisionar.sh`, `infra/deploy.sh` | `infra/dokku/` |
| `infra/instant-*.sh`, `infra/google-oauth.sh` | `infra/instant/` |
| `infra/front.sh` | `infra/front.sh` (sem mudança) |
| `painel/` | `infra/painel/` |
| `discussion/ideias.md` | `docs/ideias.md` |
| `spikes/` | `docs/spikes/` |
| `wrangler.jsonc`, `package.json`, `bun.lock`, `tsconfig.base.json` | ficam na raiz (o build da Cloudflare roda `bunx wrangler deploy` da raiz) |

Alto nível final: `app`, `worker`, `mcp`, `pacotes`, `infra`, `scripts` e `docs`.

## Regras
- Imports entre pacotes passam a usar nomes de pacote (`@amigo/instant`, `@amigo/instant/teste`, `@amigo/dominio`), nunca caminhos relativos que atravessam pastas.
- O `.env` continua só na raiz. Os scripts de teste usam `--env-file` com o caminho relativo correto, e os scripts de infra calculam a raiz a partir da própria localização.
- `infra/instant/instant-push.sh` passa `INSTANT_SCHEMA_FILE_PATH` e `INSTANT_PERMS_FILE_PATH` para o `instant-cli`, que suporta as duas.
- Dockerfiles do worker, do MCP e do painel copiam os manifestos dos novos caminhos de workspace. No Dokku, só o `dockerfile-path` do `amigo-painel` muda: vira `infra/painel/Dockerfile`, refletido em `infra/dokku/provisionar.sh`.
- Os scripts mantêm o comportamento. Só os caminhos mudam.
- `git mv` em tudo, para preservar o histórico.

## Verificação (critério de "sem efeito")
1. `bun run test` na raiz passa com o mesmo número de testes de antes (297).
2. App: `svelte-check` sem erros, e o build gera os mesmos arquivos.
3. `infra/instant/instant-push.sh teste` não mostra nenhuma mudança de schema ou de regras.
4. Redeploy de `amigo-worker`, `amigo-mcp` e `amigo-painel`: os três sobem, `/health` do MCP responde `ok`, o painel responde 200 em `127.0.0.1:3999` e o worker loga a inicialização das três campainhas.
5. `bun scripts/e2e-producao.ts` passa (exit 0).
6. O push na `main` dispara o Workers Builds e o site continua no ar.

## Documentação
- `docs/README.md`: mapa do repositório, com cada pasta, o que tem, quando mexer, e os comandos do dia a dia por tarefa.
- O `README.md` da raiz fica curto: o que é o projeto, a árvore de alto nível, um link para `docs/README.md` e os URLs de produção.
- Docs e specs anteriores que citam caminhos antigos: atualizar os documentos vivos (README, `docs/handoff-google-oauth.md`, `docs/ideias.md` onde há instruções). Specs e planos datados ficam como estão, porque são registro histórico; o mapa avisa disso.
- Uma seção **"Segredos e onde guardá-los"** no `docs/README.md`, com a tabela combinada: o que vai para o Bitwarden e o que é opcional.

## Fora do escopo
Mudar o comportamento de qualquer componente, renomear `app/`, `worker/` ou `mcp/`, e mudar a configuração do Workers Builds.
