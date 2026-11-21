# Reorganização do repositório — Plano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduzir o alto nível para `app`, `worker`, `mcp`, `pacotes`, `infra`, `scripts` e `docs`, sem mudar o comportamento, e documentar onde está cada coisa.

**Architecture:** Só `git mv` e ajustes de caminho. O código compartilhado vira pacotes de workspace (`@amigo/dominio`, `@amigo/instant`), importados por nome. Deploy verificado por redeploy e e2e.

**Tech Stack:** Bun 1.4.5 workspaces, SvelteKit (Vite), Dokku, instant-cli 1.0.67, Workers Builds.

**Spec:** `docs/superpowers/specs/2026-11-21-reorganiza-repo-design.md`. A tabela de mapeamento de lá é a fonte da verdade.

## Global Constraints
- Nunca ler nem imprimir `.env`, tokens ou segredos. O `.env` fica só na raiz.
- Só `git mv` para mover arquivos. Nenhuma mudança de lógica.
- Antes e depois de mexer, `bun run test` na raiz deve dar 297 testes passando e 0 falhando. Anote o número exato antes de começar.
- Na VPS, só os apps `amigo-*`. Nunca `instant`, `s3` nem `backup-files`.
- Commits em pt-BR, terminando com `Co-Authored-By: <modelo> <noreply@anthropic.com>` e `Claude-Session: https://claude.ai/code/session_01QpztnEyRLvtHmCb1a9kbXu`.
- `wrangler.jsonc` fica na raiz. A configuração do Workers Builds não muda.

## Review Focus
1. **Import relativo esquecido** apontando para um caminho antigo (`../instant.schema`, `../../testes/instant-teste`, `../dominio`): falha em runtime no Docker, não no editor. O Task 1 faz `git grep` desses padrões, e o resultado precisa ser vazio.
2. **`--env-file` com profundidade errada** nos pacotes que mudaram de nível: os testes de integração quebram silenciosamente sem credenciais. O Task 1 roda a suíte inteira.
3. **Dockerfile copiando manifesto inexistente**, e o build quebra só na VPS. O Task 2 faz o redeploy real dos três.
4. **`instant-cli` sem achar o schema** e fazendo push de schema vazio, o que seria destrutivo. O Task 2 roda primeiro no app de teste e exige "sem mudanças"; se aparecer qualquer remoção, para.
5. **Scripts de infra que calculam a raiz** com `dirname "$0"/..` e agora estão um nível abaixo. O Task 2 roda cada script de infra que for usado.

---

### Task 1: Mover arquivos e corrigir caminhos (sem deploy)

**Files:** todos os listados na tabela do spec. Também `package.json` (workspaces), os `tsconfig.json` dos pacotes, `app/vite.config.ts`, `app/src/lib/instant.ts`, imports em `worker/`, `mcp/`, `scripts/` e `pacotes/`, os Dockerfiles (`worker/`, `mcp/`, `infra/painel/`) e `.dockerignore`, se citar caminhos.

**Interfaces (produz):**
- `pacotes/instant/package.json` com `name: "@amigo/instant"` e `exports`:
  - `"."` → `./schema.ts`: export default do schema e `AppSchema`;
  - `"./perms"` → `./perms.ts`;
  - `"./teste"` → `./testes/instant-teste.ts`.
- `pacotes/dominio` mantém o nome `@amigo/dominio`.
- `scripts/seed/package.json` com o nome `@amigo/seed`.
- Os workspaces da raiz: `pacotes/*`, `scripts/seed`, `infra/painel`, `worker`, `mcp` e `app`.
- Os testes de integração ficam em `pacotes/instant/testes/*.test.ts`, com o script `test` do `@amigo/instant` usando `--env-file=../../.env`. Ajuste a profundidade de cada pacote movido (seed: `../../.env`).

- [ ] **Step 1:** rodar `bun run test` na raiz e anotar o total.
- [ ] **Step 2:** fazer todos os `git mv` da tabela.
- [ ] **Step 3:** corrigir os imports para nomes de pacote (`import schema from "@amigo/instant"`, `import type { AppSchema } from "@amigo/instant"`, `from "@amigo/instant/teste"`). Atualizar os `tsconfig` `include` e o `server.fs.allow` do Vite, se preciso.
- [ ] **Step 4:** atualizar os Dockerfiles. Copiar `package.json` de cada workspace no caminho novo antes do `bun install --frozen-lockfile`, depois o código. O MCP e o worker precisam de `pacotes/dominio` e `pacotes/instant` (apenas `schema.ts` e `package.json` bastam se o kit de teste não for importado em produção; confira).
- [ ] **Step 5:** `bun install`, para regenerar o `bun.lock` com os workspaces novos.
- [ ] **Step 6:** conferir que não sobrou caminho antigo. Run: `git grep -n -E "instant\.schema|instant\.perms|\.\./testes/|/testes/instant-teste|\bingestao/|\bbin/(painel|codigo-magico)|\bdiscussion/|(^|[^a-z])painel/Dockerfile|infra/(provisionar|deploy|instant-|google-oauth)" -- ':!bun.lock' ':!docs/superpowers'`. Expected: só ocorrências em docs que o Task 3 vai atualizar (README, `docs/handoff-google-oauth.md`, `docs/ideias.md`). Nenhuma em código, Dockerfile ou script.
- [ ] **Step 7:** rodar a suíte. Run: `bun run test`. Expected: o mesmo total do Step 1, 0 falhas. Também `cd app && bun --bun svelte-check && bun --bun vite build`, com 0 erros.
- [ ] **Step 8:** rodar `tsc --noEmit` em `worker`, `mcp`, `pacotes/dominio`, `pacotes/instant` e `scripts/seed` (onde houver tsconfig). Expected: limpo.
- [ ] **Step 9:** Commit `refactor: reorganiza o repositório em pacotes/, infra/, scripts/ e docs/`. **Não dar push nem deploy.**

---

### Task 2: Ajustar os scripts de infra e verificar o deploy

**Files:** `infra/instant/*.sh`, `infra/dokku/*.sh`, `infra/front.sh`, `scripts/painel`, `scripts/codigo-magico`.

- [ ] **Step 1:** corrigir em cada script o cálculo da raiz (`raiz="$(cd "$(dirname "$0")/../.." && pwd)"` nos que estão em `infra/<sub>/`) e todos os caminhos internos.
- [ ] **Step 2:** fazer o `instant-push.sh` exportar `INSTANT_SCHEMA_FILE_PATH=pacotes/instant/schema.ts` e `INSTANT_PERMS_FILE_PATH=pacotes/instant/perms.ts`, relativos à raiz, onde o CLI roda.
- [ ] **Step 3:** rodar `infra/instant/instant-push.sh teste`. Expected: nenhuma mudança de schema nem de regras. **Se o plano mostrar qualquer remoção de atributo ou entidade, PARE e reporte BLOCKED sem confirmar.** Depois rodar com `prod`. Expected: também sem mudanças.
- [ ] **Step 4:** no `infra/dokku/provisionar.sh`, mudar o `dockerfile-path` do `amigo-painel` para `infra/painel/Dockerfile`. Rodar o script. Expected: só essa mudança. Na segunda execução, `mudanças: 0`.
- [ ] **Step 5:** redeploy com `infra/dokku/deploy.sh amigo-worker`, `amigo-mcp` e `amigo-painel`. Isso exige commit antes, porque o deploy envia o HEAD da branch. Conferir:
  - logs do worker com as três campainhas, sem stack trace;
  - `curl https://amigo-mcp.app.tpou.gy/health` → `ok`;
  - `ssh vps-mercurio 'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3999/'` → `200`.
- [ ] **Step 6:** rodar `bun scripts/e2e-producao.ts`. Expected: exit 0, sem sobras.
- [ ] **Step 7:** rodar `scripts/codigo-magico --help` ou um uso equivalente que não exponha segredo, e `bash -n` nos scripts de infra que não forem executados.
- [ ] **Step 8:** Commit `fix(infra): caminhos dos scripts após a reorganização`.

---

### Task 3: Documentação "onde está cada coisa" e segredos

**Files:** criar `docs/README.md`; reescrever o `README.md` da raiz; atualizar os caminhos em `docs/handoff-google-oauth.md` e nas instruções de `docs/ideias.md`; criar um `README.md` curto em `pacotes/`, `infra/` e `scripts/` (2 a 6 linhas cada, apontando para `docs/README.md`).

**Conteúdo do `docs/README.md`:**
1. **Mapa:** a árvore do alto nível até o segundo nível, com uma linha por pasta: o que tem e quando mexer.
2. **Fluxos do dia a dia,** com os comandos exatos dos caminhos novos:
   - rodar local;
   - testar;
   - publicar o front (push na `main`; manual com `infra/front.sh`);
   - publicar o worker, o MCP ou o painel (`infra/dokku/deploy.sh <app>`);
   - mudar schema ou regras (`infra/instant/instant-push.sh teste` e depois `prod`);
   - ver o painel (`scripts/painel`);
   - e2e (`bun scripts/e2e-producao.ts`);
   - seed;
   - Google OAuth (`infra/instant/google-oauth.sh`).
3. **Produção:** URLs (front, MCP, Instant) e os apps Dokku `amigo-*`.
4. **Segredos e onde guardá-los:** a tabela do spec, com Bitwarden obrigatório para os admin tokens do Instant (prod e teste) e para os client ID e secret do Google (site e MCP), e opcional para `SORTEIO_SEGREDO`, `MCP_ENCRYPTION_KEY` e `MCP_JWT_KEY`. Incluir onde cada um vive hoje e o comando para o próprio Thomaz consultar os tokens do Instant na VPS: `ssh vps-mercurio 'cat /root/instant-apps/amigo-secreto.env /root/instant-apps/amigo-secreto-teste.env; echo'`. **Nunca escreva valores.**
5. **Histórico:** `docs/superpowers/specs` e `plans` são registros datados e podem citar caminhos antigos. O mapa vale.

- [ ] **Step 1:** escrever os arquivos.
- [ ] **Step 2:** conferir que todo comando e caminho citado existe. Run: um script que extrai os caminhos entre crases dos READMEs novos e testa `-e`. Expected: todos existem.
- [ ] **Step 3:** Commit `docs: mapa do repositório e segredos`.
