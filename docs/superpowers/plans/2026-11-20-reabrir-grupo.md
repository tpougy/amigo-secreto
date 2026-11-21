# Reabrir grupo — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o organizador desfaça o sorteio e reabra o grupo para retardatários. O limite passa a ser de 3 sorteios por abertura.

**Architecture:** O organizador cria uma `reaberturas` no Instant. O worker, pela campainha genérica e por `dispararComRetomada`, roda o workflow `reabrir-grupo`. Esse workflow apaga os pares, volta o grupo para `aberto` e grava `rodadaBase = rodadaAtual`. O limite de rodadas passa a ser `rodada − rodadaBase ≤ 3` nas regras, no worker e no app.

**Tech Stack:** a mesma do piloto: Bun 1.4.5, instantdb-rust, OpenWorkflow 0.11.0, SvelteKit SPA e fastmcp.

**Spec:** `docs/superpowers/specs/2026-11-20-reabrir-grupo-design.md`. Base: `docs/superpowers/specs/2026-11-20-amigo-secreto-design.md`. Os README e §10 do `discussion/ideias.md` descrevem a infra e os achados.

## Global Constraints

- Todas as restrições globais do plano anterior continuam valendo (`docs/superpowers/plans/2026-11-20-amigo-secreto-piloto.md`, seção Global Constraints): Bun 1.4.5, versões fixadas, app de teste para os testes, nada de imprimir segredos, logs só com ids, UI em pt-BR, só os apps Dokku `amigo-*` e commits em pt-BR com a linha de atribuição.
- Os textos exatos estão no spec: os dois níveis da confirmação, `REABRIR` e o aviso aos participantes "O sorteio foi desfeito pelo organizador para incluir mais gente. Aguarde o novo sorteio."
- Limite: `LIMITE_RODADAS = 3` por abertura. `rodadaBase` ausente vale 0 em todos os lugares.
- Rate limit `reabertura`: 5 tokens com recarga de 5 por hora.
- Deploy em ordem:
  1. `infra/instant-push.sh teste`, depois `prod`;
  2. `infra/deploy.sh amigo-worker` (e `amigo-mcp` se mudar);
  3. `infra/pages.sh`.

## Review Focus

1. **Dois cliques em "Reabrir":** a segunda reabertura encontra o grupo já `aberto` e vira `erro` ("O grupo não está sorteado"), sem apagar nada a mais. A UI desabilita o botão enquanto há reabertura `pendente`. Testado na Task 2.
2. **Retardatário tenta entrar com a reabertura ainda `pendente`** (grupo ainda `sorteado`): a regra recusa a entrada, e a tela mostra a mensagem de grupo fechado. Testado na Task 1.
3. **Grupos antigos sem `rodadaBase`** são tratados como 0 nas regras, no worker e no app. Testado nas Tasks 1, 2 e 3.
4. **O banner "participante saiu depois do sorteio" some depois de reabrir**, porque o grupo fica `aberto`. O participante vê o aviso de sorteio desfeito, e não "Você tirou". Testado na Task 3 (função pura).
5. **Reabrir com grupo apagado ou encerrado no meio:** vira `erro`, sem registros fantasma. Testado na Task 2.

---

### Task 1: Schema, regras e testes de permissão

**Files:**
- Modify: `instant.schema.ts`, `instant.perms.ts`, `testes/instant-teste.ts`
- Test: `testes/permissoes.reabrir.test.ts` (novo)

**Interfaces:**
- Produces:
  - `grupos.rodadaBase: number` (opcional);
  - entidade `reaberturas` { `status` string indexada, `erro` string opcional, `criadoEm` date }, com o link `reaberturaGrupo`: `reaberturas.grupo` (um) ↔ `grupos.reaberturas` (muitos), `onDelete: "cascade"`;
  - `$rateLimits.reabertura`;
  - helper `pedirReabertura(org, grupoId): Promise<string /*reaberturaId*/>` em `testes/instant-teste.ts`;
  - helper `simularReabertura(admin, grupoId)`: apaga os pares, grava `status:"aberto"`, `rodadaBase = rodadaAtual` e marca a reabertura `concluido`.

- [ ] **Step 1: Escrever `testes/permissoes.reabrir.test.ts`.** Grupo com organizador O e participantes A, B e C, sorteado via `simularWorker`. Asserções:
  1. A cria reabertura → `permission-denied`.
  2. O cria reabertura com o grupo `aberto` → `permission-denied`. Mesmo resultado com grupo `encerrado` e com sorteio `pendente` existente.
  3. O cria reabertura com o grupo `sorteado` → ok. A vê a reabertura. Um estranho não vê.
  4. Ninguém faz `update` ou `delete` de reabertura (nem O) → `permission-denied`.
  5. Enquanto a reabertura está `pendente` e o grupo segue `sorteado`, um retardatário R tenta entrar com o código → `permission-denied` (Review Focus 2).
  6. Depois de `simularReabertura`: R entra com o código; A, O e R consultam `pares` → `[]`.
  7. Depois de reabrir com `rodadaAtual = 1`: O pede o sorteio da rodada 2 → ok. Com `rodadaBase = 1`, a rodada 4 é ok e a rodada 5 dá `permission-denied`.
  8. Grupo sem `rodadaBase` (legado): as rodadas 1 a 3 são aceitas e a rodada 4 é recusada (Review Focus 3).
  9. O tenta gravar `rodadaBase` diretamente → `permission-denied`.
  10. A 6ª reabertura de O em uma hora → `rate-limited`.
- [ ] **Step 2: Ver os testes falharem**, implementar schema e regras e rodar `infra/instant-push.sh teste`. Run: `bun test testes/`. Expected: PASS em tudo, incluindo as suítes antigas.
- [ ] **Step 3: Aplicar em produção.** Run: `infra/instant-push.sh prod`. Expected: sem erro. Confira com pull que `rodadaBase` e `reaberturas` existem.
- [ ] **Step 4: Commit.** `git commit -m "feat(instant): reaberturas e limite de rodadas por abertura"`

---

### Task 2: Workflow `reabrir-grupo` no worker

**Files:**
- Create: `worker/workflows/reabrirGrupo.ts`, `worker/workflows/reabrirGrupo.test.ts`
- Modify: `worker/main.ts`, `worker/workflows/sortear.ts` (validação da rodada com `rodadaBase`)

**Interfaces:**
- Consumes: `iniciarCampainha`, `assinaturaInstant`, `log`, `dispararComRetomada` (`worker/nucleo/`); o padrão de `worker/workflows/apagarConta.ts`.
- Produces:
  - `definirReabrirGrupo(ow, db, opcoes?: { retryPasso?: Partial<RetryPolicy> })`, que registra o workflow `"reabrir-grupo"` versão `"1"`, com input `{ reaberturaId: string }` e output `{ ignorado: true } | { pares: number } | { erro: string }`;
  - `processarReaberturas(ow, db): { parar(): void }`, que observa `reaberturas` com `status = "pendente"` e usa `idempotencyKey = reaberturaId`;
  - em `worker/main.ts`, uma entrada `{ nome: "reaberturas", abrir: () => processarReaberturas(ow, db) }`.

**Passos do workflow:**
1. `carregar`: reabertura inexistente ou já `concluido`/`erro` → `{ ignorado: true }`.
2. `reabrir`: numa transação única, relendo o estado no mesmo passo:
   - grupo inexistente → marca a reabertura `erro: "O grupo não existe mais"`, se ela ainda existir;
   - grupo não `sorteado` → `erro: "O grupo não está sorteado"`;
   - sorteio `pendente` ou `processando` → `erro: "Há um sorteio em andamento"`;
   - caso contrário: apaga todos os pares do grupo, grava `status: "aberto"` e `rodadaBase: rodadaAtual`, e marca a reabertura `concluido`.

Logs: `reabertura.concluida` (com `reaberturaId`, `grupoId` e `pares`) e `reabertura.erro` (com o código).

Em `sortear.ts`, a validação de rodada do `carregar` passa a exigir `rodada === rodadaAtual + 1 && rodada - (rodadaBase ?? 0) <= 3`. Se falhar, `erro: "Rodada inválida"`, como já é hoje.

- [ ] **Step 1: Escrever os testes de integração** (app de teste, `OW_DB` temporário, `SORTEIO_SEGREDO` de teste):
  1. Grupo sorteado com 4 participantes, reabrir → reabertura `concluido`, 0 pares no grupo, grupo `aberto`, `rodadaBase == rodadaAtual == 1`.
  2. Ciclo completo: reabrir, R entra, sorteio da rodada 2 via `definirSorteio` → 5 pares, cada um vê exatamente 1, `rodadaAtual == 2`.
  3. Duas reaberturas criadas seguidas (Review Focus 1): a primeira fica `concluido` e a segunda `erro` com "O grupo não está sorteado". Os pares do novo sorteio, se já existirem, não são tocados.
  4. A mesma reabertura disparada duas vezes, ou de novo depois de apagar o `ow.db` → nenhuma mudança extra.
  5. Grupo apagado antes do passo `reabrir` → nenhum `grupos` ou `reaberturas` fantasma (Review Focus 5). Grupo `encerrado` → `erro` e o grupo continua `encerrado`.
  6. Sorteio com `rodadaBase` ausente: as regras de rodada do worker tratam como 0 (Review Focus 3).
- [ ] **Step 2: Ver falhar, implementar e ver passar.** Run: `bun test worker/`. Expected: PASS em tudo.
- [ ] **Step 3: Deploy.** Run: `infra/deploy.sh amigo-worker`. Depois, `ssh vps-mercurio 'dokku logs amigo-worker --num 20'` deve mostrar o worker iniciado, sem stack trace.
- [ ] **Step 4: Commit.** `git commit -m "feat(worker): workflow reabrir-grupo"`

---

### Task 3: App, MCP, e2e e docs

**Files:**
- Modify: `app/src/lib/grupo/regras.ts` (e o teste dela), `app/src/lib/components/PainelSorteio.svelte`, `app/src/routes/(app)/grupos/[id]/+page.svelte`, `app/src/lib/grupo/consultas.ts` (trazer `rodadaBase` e `reaberturas`), `mcp/ferramentas.ts` (se precisar, para a resposta com grupo reaberto), `testes/e2e-producao.ts`, `README.md`, `discussion/ideias.md` §10.

**Interfaces:**
- Consumes: as entidades da Task 1; o worker da Task 2 em produção.
- Produces, em `regras.ts`:
  - `rodadasNestaAbertura(g: { rodadaAtual: number; rodadaBase?: number | null }): number` = `rodadaAtual − (rodadaBase ?? 0)`;
  - `confirmacaoRefazer`, que passa a receber `rodadaBase` e a usar `rodadasNestaAbertura` para o limite;
  - `confirmacaoReabrir(e: { viram: number }): { nivel: "simples" | "forte"; texto: string }`, com os textos exatos do spec;
  - `estadoParaParticipante(g: { status: string; rodadaAtual: number }, temPar: boolean): "aguardando" | "desfeito" | "tirou" | "fora"`. `"desfeito"` vale quando `status === "aberto" && rodadaAtual > 0`.

Comportamento da UI:
- **Botão "Reabrir grupo para novos participantes"**, na aba Sorteio do organizador. Aparece só com o grupo `sorteado` e sem sorteio em andamento. Fica desabilitado com o texto "Reabrindo…" enquanto houver reabertura `pendente`. Abre o `ConfirmarAcao` com `confirmacaoReabrir` (`exigir: "REABRIR"` no nível forte) e cria a `reaberturas`.
- **Erro da reabertura:** a mensagem aparece no painel.
- **Participante:** o estado `"desfeito"` mostra o aviso exato do spec no lugar de "Você tirou".
- **Contador:** "rodada N de 3" usa `rodadasNestaAbertura`.
- **MCP:** com o grupo reaberto, `meuAmigoSecreto` devolve o aviso de sorteio que ainda não aconteceu, o que já deve ocorrer porque não há par. Confirme com um teste em `mcp/ferramentas.test.ts`.

- [ ] **Step 1: Testes unitários em `regras.test.ts`:**
  - `confirmacaoReabrir({viram:0})` → nível `simples` com o texto exato;
  - `confirmacaoReabrir({viram:2})` → nível `forte` com "2 pessoa(s) já viram quem tiraram. Reabrir desfaz o sorteio de todos.";
  - `rodadasNestaAbertura` com `rodadaBase` ausente, 0 e 3;
  - `confirmacaoRefazer` com `rodadaAtual: 4, rodadaBase: 3` → permitido; com `rodadaAtual: 6, rodadaBase: 3` → "Limite de 3 sorteios atingido";
  - `estadoParaParticipante`: os 4 casos, incluindo `aberto` com rodada 0 → `"aguardando"` e `aberto` com rodada 1 → `"desfeito"` (Review Focus 4);
  - o banner de removido não aparece com o grupo `aberto`.
- [ ] **Step 2: Ver falhar, implementar e ver passar.** Run: `cd app && bun test src && bun --bun svelte-check && bun --bun vite build`. Expected: PASS, 0 erros.
- [ ] **Step 3: Estender o e2e de produção.** Depois do sorteio atual:
  1. O pede a reabertura;
  2. espera `concluido` por até 60 s;
  3. um retardatário R entra pelo código;
  4. sortear a rodada 2;
  5. cada um dos 5 vê exatamente 1 par;
  6. limpeza.

  Run: `bun testes/e2e-producao.ts`. Expected: exit 0, sem sobras.
- [ ] **Step 4: Smoke no navegador** (Chromium headless, contas por magic code via `bin/codigo-magico` ou admin `generateMagicCode`):
  1. o organizador reabre com confirmação simples;
  2. o participante vê o aviso de desfeito;
  3. o retardatário entra;
  4. novo sorteio, e "Você tirou" volta para todos.

  Limpar os dados no fim. Run: `infra/pages.sh`.
- [ ] **Step 5: Docs.** No README, a seção do fluxo ganha uma linha sobre reabrir. Em `ideias.md` §10, linhas de achados, se houver.
- [ ] **Step 6: Suíte inteira e commit.** Run: `bun run test` na raiz. Expected: exit 0. Depois, `git commit -m "feat(app): reabrir grupo para retardatários"`.
