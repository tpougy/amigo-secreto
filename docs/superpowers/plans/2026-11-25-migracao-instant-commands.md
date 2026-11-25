# Migração do amigo-secreto para o `instant-commands` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar a campainha própria do worker pela biblioteca `instant-commands` nos três pedidos (sortear, reabrir grupo, apagar conta), com schema e regras gerados, app/MCP/e2e no vocabulário novo, pronto para um corte único em produção.

**Architecture:** Os três commands são declarados em `pacotes/instant/commands.ts` e alimentam `schema.ts` (`commandEntities`/`commandLinks`) e `perms.ts` (`mergePerms`). O worker passa a ter handlers (`worker/handlers/`) e um schedule (`worker/schedules/`) registrados num `createRunner` em modo `subscription`; a campainha sai. O app cria pedidos com `sendCommand` e lê `pending/running/done/failed`. O corte em produção **não** faz parte da execução deste plano: a Task 9 só escreve o roteiro.

**Tech Stack:** Bun 1.4.5, TypeScript, `@instantdb/core`/`@instantdb/admin` 1.0.67, `openworkflow` 0.11.0 (SQLite), `instant-commands` (workspace), Svelte 5 (app), zod 4.6.7.

**Spec:** `docs/superpowers/specs/2026-11-25-migracao-instant-commands-design.md` (ler inteira antes de qualquer tarefa; é a autoridade). Biblioteca: `pacotes/instant-commands/README.md`.

## Global Constraints

- Vocabulário: status `pending`/`running`/`done`/`failed`; campos `error`, `createdAt`, `finishedAt`, `attempts`, `result`. "Aberto" = `pending || running` em todo lugar (regras CEL, worker, app, MCP, e2e). Nenhum `pendente`/`processando`/`concluido`/`'erro'` como status, nem `criadoEm`/`concluidoEm`/`erro` como campo desses três pedidos, pode sobrar fora de comentários históricos.
- Entidades e links mantêm os nomes: `sorteios`, `reaberturas`, `pedidosExclusao`; links `sorteioGrupo`, `reaberturaGrupo`, `pedidoExclusaoUsuario` com os labels de hoje (`grupo`, `sorteios`, `reaberturas`, `usuario`, `pedidosExclusao`).
- Commands (exports de `pacotes/instant/commands.ts`): `sorteio` (`name: "sorteio"`), `reabertura` (`name: "reabertura"`), `exclusaoConta` (`name: "exclusao-conta"`), e `commands = [sorteio, reabertura, exclusaoConta] as const`. `commands.ts` importa só `instant-commands` (nunca `instant-commands/worker`).
- `defaultErrorMessage`, exatas: sorteio `"Não foi possível concluir o sorteio. Tente de novo."`; reabertura `"Não foi possível reabrir o grupo. Tente de novo."`; exclusão `"Não foi possível apagar a conta."`. Mensagens de negócio: as constantes de hoje (`MSG_RODADA_INVALIDA`, `MSG_PARTICIPANTES_MUDARAM`, `MSG_GRUPO_ENCERRADO`, `MSG_GRUPO_NAO_EXISTE`, `MSG_GRUPO_NAO_SORTEADO`, `MSG_SORTEIO_EM_ANDAMENTO`, e as de `ErroSorteio`).
- Handlers: `version: "1"`; `retryPolicy` padrão = `RETRY_PASSO_PADRAO` (`maximumAttempts: 300`, `initialInterval: "1s"`, `backoffCoefficient: 2`, `maximumInterval: "60s"`), sobrescrevível só pelos testes.
- `liberarChave`: renomeia `chave` para `` `${chave}:erro:${id}` ``, com guarda `typeof command.chave === "string"`.
- Schedule: `name: "reprocessar-exclusoes"`, `cron: "0 4 * * *"`, `timezone: "America/Sao_Paulo"`; desiste com **3** pedidos `failed` do mesmo usuário; eventos de log `exclusao.desistiu` e `exclusao.falhou`. O `onEvent` loga todo evento como `ic.<type>` com o `log` de `worker/nucleo/log.ts`.
- Reação a falhas só por `command.failed` (nunca por `run.failed`).
- Testes de integração usam os apps **de teste**, nunca produção: `pacotes/instant` e `worker` usam `@amigo/instant/teste` (`adminTeste`, `novoPrefixo`, `limparTudo`); push de regras só com `infra/instant/instant-push.sh teste`. **Nunca** `instant-push.sh prod` nem deploy neste plano.
- Nunca escrever `.env` num comando de shell (um hook recusa). Rodar testes pelos scripts: `cd pacotes/instant && bun run test [arquivo]`, `cd worker && bun run test [arquivo]`, `cd app && bun run test` e `bun run check`, `cd mcp && bun run test`.
- Entre a Task 1 e a Task 6, os testes antigos do worker (`worker/workflows/{sortear,reabrirGrupo,apagarConta}.test.ts`, `worker/nucleo/campainha.test.ts`) ficam obsoletos (rodam contra o schema novo) e não são rodados; a Task 6 os apaga. Cada task roda só os testes dos arquivos que tocou, mais a suíte do próprio pacote quando indicado.
- Commits em português, Conventional Commits, escopo da área (`instant`, `worker`, `app`, `mcp`, `scripts`, `docs`), com as linhas de atribuição da sessão.

## Review Focus

1. **Reabertura em `running` não pode liberar sorteio** (e vice-versa; e entrada de participante com sorteio `running`): os testes de permissão da Task 1 escrevem `running` direto como admin e esperam `permission-denied`.
2. **Pares pelo lado do sorteio:** cliente (organizador ou membro) não liga nem desliga `pares` de um sorteio, por nenhum dos lados. Teste na Task 1; se passar a permitir, **parar** e reportar BLOCKED (decisão da spec).
3. **Falha inesperada do sorteio libera a `chave`:** passo que esgota as tentativas → `failed` com a mensagem padrão e a chave renomeada; um novo sorteio da mesma rodada é aceito. Teste na Task 5.
4. **Grupo apagado durante o sorteio ou a reabertura:** nada é recriado (nem o command, nem pares, nem o grupo). Testes nas Tasks 3 e 5.
5. **`reabrindo()` no app e as regras com `running`:** `consultas.ts` trata `running` como aberto em sorteio e reabertura. Teste na Task 7.

---

### Task 1: Commands, schema e regras

**Files:**
- Create: `pacotes/instant/commands.ts`
- Modify: `pacotes/instant/schema.ts`, `pacotes/instant/perms.ts`, `pacotes/instant/package.json`
- Create: `pacotes/instant/testes/permissoes.commands.test.ts`

**Interfaces:**
- Produces: `sorteio`, `reabertura`, `exclusaoConta`, `commands` (Global Constraints); `@amigo/instant/commands` (novo export em `package.json`, que também ganha `"instant-commands": "workspace:*"`); `emAberto(caminho: string): string` exportado de `perms.ts`, devolvendo `"('pending' in data.ref('<caminho>') || 'running' in data.ref('<caminho>'))"` (as regras usam `!emAberto(...)`).
- `result`: `sorteio`/`reabertura` = `z.object({ pares: z.number().int() })`; `exclusaoConta` = `z.object({ anonimizadas, semRefazer, apagadas, grupos })`, todos `z.number().int()`.

- [ ] **Step 1: Escrever `commands.ts`** com a tabela "Módulo dos commands" da spec e as regras transcritas de `perms.ts` (seção "Regras" da spec). Os `bind` reaproveitam os textos de hoje; `semReaberturaAberta` e `semSorteioAberto` usam `!emAberto('grupo.reaberturas.status')` / `!emAberto('grupo.sorteios.status')`. `rateLimit` do sorteio e da reabertura: `{ limits: [{ capacity: 5, refill: { amount: 5, period: "1 hour", type: "greedy" } }] }`.
- [ ] **Step 2: `schema.ts`:** remover as três entidades e os três links; espalhar `...commandEntities(commands)` e `...commandLinks(commands)`.
- [ ] **Step 3: `perms.ts`:** exportar `emAberto`; tirar de `rules` as entradas `sorteios`, `reaberturas`, `pedidosExclusao`, `$rateLimits.sorteio`/`reabertura`, os `link`/`unlink` `sorteios`/`reaberturas` de `grupos`; `participantes.semSorteioEmAndamento` = `!emAberto('grupo.sorteios.status')`; `export default { ...mergePerms(rules, commands), ...regrasStreams }`. `$users` mantém `view`/`delete`.
- [ ] **Step 4: Push no app de teste:** `infra/instant/instant-push.sh teste`. Se o servidor recusar as regras de link geradas em `$users` (`pedidosExclusao`), aplicar a decisão da spec: remover `$users.allow.link.pedidosExclusao`/`unlink.pedidosExclusao` da saída de `mergePerms` antes de exportar, com comentário, e acrescentar a pendência no fim de `docs/superpowers/plans/2026-11-25-instant-commands.md`. Registrar no relatório o que o servidor respondeu.
- [ ] **Step 5: Escrever `permissoes.commands.test.ts`** (higiene do pacote: `novoPrefixo`, `limparTudo` no `afterAll`; criar pedidos com `sendCommand(usuario.db, cmd, input)`; estados `running` escritos com `adminTeste()`):
  - `"sorteio negado com reabertura running"` → `permission-denied`;
  - `"reabertura negada com sorteio running"` → `permission-denied`;
  - `"entrada de participante negada com sorteio running"` → `permission-denied`;
  - `"cliente não muda status de command"` (update de `status`/`error` num sorteio e numa reabertura) → `permission-denied`;
  - `"cliente não liga nem desliga pares de um sorteio"`: organizador e membro tentam `tx.sorteios[id].link({ pares })`, `.unlink({ pares })`, `tx.pares[p].link({ sorteio })`, `.unlink({ sorteio })` → todos negados (Review Focus 2);
  - `"exclusão: dono cria e vê; outro não vê nem cria para terceiros"`;
  - `"sorteio feliz: organizador cria a rodada 1 com sendCommand"` → `pending`, `attempts: 0`.
- [ ] **Step 6: Rodar** `cd pacotes/instant && bun run test testes/permissoes.commands.test.ts`. Esperado: PASS (os testes antigos `permissoes.*` são da Task 2).
- [ ] **Step 7: Commit** `feat(instant): commands do sorteio, reabertura e exclusão com schema e regras gerados`.

---

### Task 2: Testes de permissão existentes e kit de teste

**Files:**
- Modify: `pacotes/instant/testes/instant-teste.ts` (`simularWorker`, `pedirReabertura`, `simularReabertura` e o que mais citar o vocabulário antigo)
- Modify: `pacotes/instant/testes/permissoes.{sorteio,reabrir,conta,grupos,perfis,estatisticas}.test.ts` (só os que citam os três pedidos)

**Interfaces:**
- Consumes: `sorteio`, `reabertura`, `exclusaoConta` (Task 1).
- Produces: `simularWorker(a, sorteioId, pares)` grava `status: "done"`, `finishedAt`; `pedirReabertura(org, grupoId)` usa `sendCommand`; `simularReabertura` grava `done`. Assinaturas inalteradas.

- [ ] **Step 1:** Atualizar o kit e os testes para o vocabulário novo e para `sendCommand`. Os testes que conferiam "status diferente de pendente → permission-denied" passam a conferir que `sendCommand` grava `pending` e que um `create` direto com `status: "done"` é negado. O teste do rate limit (6ª reabertura) continua com o mesmo número.
- [ ] **Step 2: Rodar** `cd pacotes/instant && bun run test`. Esperado: PASS em todos os `permissoes.*`, inclusive `permissoes.conta.test.ts` (se falhar por restos de execuções interrompidas, apagar o prefixo que sobrou com `limparTudo` e registrar no relatório).
- [ ] **Step 3: Commit** `test(instant): permissões no vocabulário do instant-commands`.

---

### Task 3: Base do worker e handler da reabertura

**Files:**
- Modify: `worker/package.json` (`"instant-commands": "workspace:*"`)
- Create: `worker/commands.ts`, `worker/handlers/reabertura.ts`, `worker/handlers/reabertura.test.ts`, `worker/handlers/comum.ts`

**Interfaces:**
- Produces:
  - `worker/commands.ts`: `export const { defineHandler, defineSchedule, createRunner } = ic.initCommands<AppSchema>()` e `export type Ctx<C extends ic.Command> = ic.HandlerContext<C, AppSchema>`.
  - `worker/handlers/comum.ts`: `RETRY_PASSO_PADRAO` (movido de `sortear.ts`), `type AdminDb = InstantAdminDatabase<AppSchema>`, e `rodarComRunner(handlers, opcoes)`: helper **de teste** (pode morar em `worker/handlers/teste.ts` se preferir) que monta `OpenWorkflow` SQLite temporário + `createRunner({ trigger: { type: "subscription" }, concurrency: 1 })` e devolve `{ runner, eventos, parar() }`.
  - `worker/handlers/reabertura.ts`: `criarReaberturaHandler(opcoes?: { retryPolicy?: RetryPolicy })` devolvendo o `Handler`; constantes `MSG_GRUPO_NAO_EXISTE`, `MSG_GRUPO_NAO_SORTEADO`, `MSG_SORTEIO_EM_ANDAMENTO` movidas para cá.

- [ ] **Step 1: Escrever os testes que falham** em `reabertura.test.ts` (app de teste, um usuário novo por pedido, `limparTudo` no `afterAll`; o pedido é criado com `sendCommand` e o resultado esperado com `waitForCommand` ou relendo até terminar):
  - `"reabre o grupo sorteado: apaga os pares, grava aberto e rodadaBase, done com pares"`;
  - `"irmã aberta vira failed com MSG_GRUPO_NAO_SORTEADO na mesma transação"` (duas reaberturas `sendCommand` seguidas; uma `done`, a outra `failed`);
  - `"grupo não sorteado → failed com MSG_GRUPO_NAO_SORTEADO"`;
  - `"sorteio aberto no grupo → failed com MSG_SORTEIO_EM_ANDAMENTO"` (sorteio `running` escrito pelo admin);
  - `"grupo apagado antes do run → nada recriado"` (apagar o grupo depois do `sendCommand`; a reabertura some pela cascata e não reaparece).
- [ ] **Step 2: Rodar e ver falhar.** `cd worker && bun run test handlers/reabertura.test.ts`.
- [ ] **Step 3: Implementar** o handler com os passos `carregar` → `reabrir` (spec, seção `reabertura`), reaproveitando a lógica de `worker/workflows/reabrirGrupo.ts` (`reabrir`, `motivoErro`) com `pending || running`, `command.complete({ pares })` e `failCommand` nas irmãs; erros de negócio com `ic.fail`. Não apagar `workflows/reabrirGrupo.ts` ainda (Task 6).
- [ ] **Step 4: Rodar e ver passar.** O mesmo comando.
- [ ] **Step 5: Commit** `feat(worker): handler da reabertura no instant-commands`.

---

### Task 4: Handler da exclusão de conta e reprocessamento

**Files:**
- Create: `worker/handlers/exclusaoConta.ts`, `worker/handlers/exclusaoConta.test.ts`, `worker/schedules/reprocessarExclusoes.ts`, `worker/schedules/reprocessarExclusoes.test.ts`

**Interfaces:**
- Consumes: `worker/commands.ts`, `RETRY_PASSO_PADRAO`, helper de teste (Task 3).
- Produces: `criarExclusaoContaHandler(opcoes?: { retryPolicy?: RetryPolicy })`; `reprocessarExclusoes` (o `Schedule` de `defineSchedule`) e, separada e testável, `async function reprocessar(db: AdminDb, agora?: number): Promise<{ criados: number; desistiu: number }>`.

- [ ] **Step 1: Escrever os testes que falham.**
  - `exclusaoConta.test.ts`: `"apaga a conta: participações, grupos organizados e $users; pedido done com o resumo"`; `"usuário já apagado (reexecução) → done sem erro"`.
  - `reprocessarExclusoes.test.ts` (chamando `reprocessar(admin)` direto; pedidos `failed` escritos pelo admin com os campos padrão):
    - `"cria um pedido novo pending para usuário com 1 failed e nada aberto"` → `criados: 1`, o novo tem `status: "pending"`, `attempts: 0`, link `usuario`;
    - `"não cria se o usuário já tem pedido pending, running ou done"`;
    - `"desiste com 3 failed"` → `desistiu: 1`, nenhum pedido novo;
    - `"ignora failed cujo usuário não existe mais"`.
- [ ] **Step 2: Rodar e ver falhar.** `cd worker && bun run test handlers/exclusaoConta.test.ts schedules/reprocessarExclusoes.test.ts`.
- [ ] **Step 3: Implementar.** Handler com `carregar` → `limpar-dados` → `apagar-usuario`, reaproveitando `dadosDaConta`/`limparDados` de `workflows/apagarConta.ts` (mover para o handler ou para um módulo de domínio do worker), retornando o resumo. `reprocessar` cria o pedido com `sendCommand(db, exclusaoConta, { usuario })` se ele aceitar o admin; senão com `db.tx.pedidosExclusao[id()].create({ status: "pending", attempts: 0, createdAt: Date.now(), error: null, result: null, finishedAt: null }).link({ usuario })` (registrar qual no relatório). Log `exclusao.desistiu` com o `usuarioId` só por id.
- [ ] **Step 4: Rodar e ver passar.** O mesmo comando.
- [ ] **Step 5: Commit** `feat(worker): handler da exclusão de conta e reprocessamento diário`.

---

### Task 5: Handler do sorteio

**Files:**
- Create: `worker/handlers/sorteio.ts`, `worker/handlers/sorteio.test.ts`

**Interfaces:**
- Consumes: Task 3 (`commands.ts`, `comum.ts`, helper de teste); `worker/nucleo/seed.ts` (`seedDoSorteio`, `validarSegredo`), `worker/nucleo/progresso.ts` (`escreverFase`), `@amigo/dominio` (`sortear`, `ErroSorteio`).
- Produces: `criarSorteioHandler(opcoes: { segredo: string; retryPolicy?: RetryPolicy })`; `liberarChave` (exportada, é o `onFailure`); `streamDoSorteio(id)`; `aoFalharSorteio(db, commandId)`: escreve a fase `"erro"` final no stream (usada pelo `onEvent` na Task 6); constantes `MSG_RODADA_INVALIDA`, `MSG_PARTICIPANTES_MUDARAM`, `MSG_GRUPO_ENCERRADO`, `LIMITE_RODADAS`, `rodadaValida` movidas para cá.

- [ ] **Step 1: Escrever os testes que falham** em `sorteio.test.ts` (segredo de teste `"0123456789abcdef".repeat(4)`, como hoje):
  - `"sorteio feliz: pares gravados, grupo sorteado, done com { pares }"`, e os pares são os mesmos para a mesma seed (determinismo, como o teste atual);
  - `"participantes mudaram entre carregar e gravar → failed com MSG_PARTICIPANTES_MUDARAM e chave renomeada"` (pode testar a função `gravarPares` direto, como o teste atual faz, e a liberação via `onFailure` pelo runner);
  - `"passo que esgota as tentativas (política curta) → failed com a mensagem padrão e chave renomeada; nova rodada igual é aceita por sendCommand"` (Review Focus 3; provocar a falha com um db que lança no passo `gravar-pares`, como `sortear.test.ts` faz hoje);
  - `"rodada inválida → failed com MSG_RODADA_INVALIDA"`;
  - `"grupo apagado durante o run → nada recriado"` (Review Focus 4);
  - `"o stream recebe embaralhando, sorteando e pronto"` (como o teste atual de stream).
- [ ] **Step 2: Rodar e ver falhar.** `cd worker && bun run test handlers/sorteio.test.ts`.
- [ ] **Step 3: Implementar** com os passos `carregar` → `sortear` → `gravar-pares` (spec, seção `sorteio`), reaproveitando `carregar`/`gravarPares`/`estadoAtual` de `workflows/sortear.ts`: sem `marcar-processando`, sem `marcarErro`; erros de negócio com `ic.fail`; conclusão com `command.complete({ pares })` na transação de `gravar-pares`; reexecução de `gravar-pares` com o command já `done` devolve a contagem gravada; `onFailure: liberarChave`. Os pares nunca saem do passo `sortear` (regra de hoje).
- [ ] **Step 4: Rodar e ver passar.** O mesmo comando.
- [ ] **Step 5: Commit** `feat(worker): handler do sorteio com liberação da chave na falha`.

---

### Task 6: `main.ts`, limpeza da campainha e Dockerfile do worker

**Files:**
- Modify: `worker/main.ts`, `worker/main.test.ts` (se precisar), `worker/Dockerfile`
- Delete: `worker/nucleo/campainha.ts`, `worker/nucleo/campainha.test.ts`, `worker/nucleo/disparar.ts`, `worker/workflows/sortear.ts`, `worker/workflows/sortear.test.ts`, `worker/workflows/reabrirGrupo.ts`, `worker/workflows/reabrirGrupo.test.ts`, `worker/workflows/apagarConta.ts`, `worker/workflows/apagarConta.test.ts` (e o que mais só servia a eles; `workflows/entradas.test.ts` é conferido: se depende dos workflows apagados, migrar o que ele cobre para os testes dos handlers)

**Interfaces:**
- Consumes: os três `criar*Handler`, `reprocessarExclusoes`, `aoFalharSorteio`, `createRunner` (Tasks 3-5).
- Produces: `worker/main.ts` conforme a spec ("`worker/main.ts`"): mantém validação de `SORTEIO_SEGREDO`, `init`, `ow` em `OW_DB`, `definirLimpeza`/`definirEstatisticas` registrados **antes** de `runner.start()`; `onEvent` = `log("ic." + e.type, e)` + em `command.failed`: `sorteio` → `aoFalharSorteio(db, e.commandId)` (assíncrono, com `.catch` próprio), `exclusao-conta` → `log("exclusao.falhou", { pedidoId: e.commandId })`; `SIGTERM`/`SIGINT` → `runner.stop()`.

- [ ] **Step 1:** Reescrever `main.ts`; apagar os arquivos listados; nenhum import restante dos apagados (`grep -rn "campainha\|disparar\|workflows/sortear\|reabrirGrupo\|apagarConta" worker` vazio, fora de comentários).
- [ ] **Step 2: `worker/Dockerfile`:** copiar `pacotes/instant-commands/package.json` antes do `bun install` e `pacotes/instant-commands/src` + `pacotes/instant/commands.ts` depois (o resto como hoje: só o necessário, sem o kit de teste). Se `docker` estiver disponível localmente, `docker build -f worker/Dockerfile .` deve terminar; senão, registrar no relatório que a verificação fica para o corte.
- [ ] **Step 3: Rodar** `cd worker && bun run test`. Esperado: PASS em tudo que sobrou (handlers, schedules, `main.test.ts`, `seed`, `limparHistorico`, `estatisticas`).
- [ ] **Step 4: Commit** `feat(worker): runner do instant-commands no lugar da campainha`.

---

### Task 7: App

**Files:**
- Modify: `app/package.json` (`"instant-commands": "workspace:*"`), `app/src/lib/grupo/consultas.ts`, `app/src/lib/grupo/consultas.test.ts`, `app/src/lib/grupo/regras.ts`, `app/src/lib/grupo/regras.test.ts`, `app/src/lib/components/PainelSorteio.svelte`, `app/src/lib/components/ConfiguracoesGrupo.svelte`, `app/src/routes/(app)/conta/+page.svelte`, `app/src/routes/(app)/grupos/[id]/+page.svelte`

**Interfaces:**
- Consumes: `sorteio`, `reabertura`, `exclusaoConta` de `@amigo/instant/commands`; `sendCommand` de `instant-commands/client`.
- Produces: `SorteioBruto = { id; status; rodada; error?; createdAt; finishedAt? }`, `ReaberturaBruta = { id; status; error?; createdAt }`; `EstadoPainel` com os mesmos `tipo`s de hoje; `rotuloStatusSorteio` com chaves `pending`/`running`/`done`/`failed` e os rótulos de hoje.

- [ ] **Step 1: Atualizar os testes** de `consultas.test.ts` e `regras.test.ts` para o vocabulário novo e acrescentar: `"reabrindo() é true com reabertura running"`, `"estadoPainel: sorteio running é andamento"`, `"emAndamento: running conta"`.
- [ ] **Step 2: Rodar e ver falhar.** `cd app && bun run test`.
- [ ] **Step 3: Implementar** `consultas.ts`/`regras.ts` (spec, seção App) e os componentes: `sendCommand` no `PainelSorteio` (sorteio e reabertura, mantendo o tratamento de `rate-limited`) e na página de conta (mantendo a confirmação no servidor antes do `signOut`); indicador de passos com `pending`/`running`/`done`; `finishedAt`/`error`; consultas das páginas pedindo os campos novos.
- [ ] **Step 4: Rodar e ver passar.** `cd app && bun run test && bun run check`. Esperado: testes PASS; `check` sem erros novos (os avisos de `any` do TS 6 já existentes podem continuar).
- [ ] **Step 5: Commit** `feat(app): pedidos com sendCommand e status do instant-commands`.

---

### Task 8: MCP, e2e de produção e Dockerfile do MCP

**Files:**
- Modify: `mcp/ferramentas.ts`, `mcp/ferramentas.test.ts`, `mcp/Dockerfile`, `scripts/e2e-producao.ts`

**Interfaces:**
- Consumes: `sorteio`, `reabertura` de `@amigo/instant/commands`; `sendCommand`.

- [ ] **Step 1: MCP:** "sorteio em andamento" = `pending || running`; pares visíveis com sorteio `done`; testes de `ferramentas.test.ts` com os valores novos, incluindo um caso com `running`. Rodar `cd mcp && bun run test`: PASS.
- [ ] **Step 2: `mcp/Dockerfile`:** mesmas cópias da Task 6 (manifesto do `instant-commands` antes do install; `src` e `pacotes/instant/commands.ts` depois). `docker build -f mcp/Dockerfile .` se houver `docker`; senão, registrar.
- [ ] **Step 3: `scripts/e2e-producao.ts`:** `sendCommand` para sorteio e reabertura; espera sair de `pending`/`running`; confere `done`. **Não rodar** contra produção; conferir só que o arquivo compila (`bunx tsc --noEmit` no arquivo, ou `bun build scripts/e2e-producao.ts --target bun --outdir <scratchpad>` sem executar).
- [ ] **Step 4: Commit** `feat(mcp): status do instant-commands; e2e com sendCommand`.

---

### Task 9: Documentação e roteiro do corte

**Files:**
- Modify: `docs/superpowers/specs/2026-11-25-migracao-instant-commands-design.md` (Status → "implementado na branch", seção final "Status da implementação e desvios"), `docs/ideias/migracao-instant-commands.md` (status), `README.md` da raiz e `infra/README.md` se citarem a campainha
- Create: `docs/runbooks/corte-instant-commands.md`

- [ ] **Step 1: Roteiro do corte** com os passos da seção "Corte" da spec, cada um com o comando exato (backup do Postgres como passo manual pelo runbook do repositório da VPS, que fica fora deste repo (citar, não copiar); consulta admin que confere as três entidades vazias; `instant-push.sh teste`, testes, `instant-push.sh prod`; deploy do worker/MCP pelo Dokku e do app por `infra/front.sh`; `bun scripts/e2e-producao.ts`) e o rollback (commit anterior de código, schema e regras).
- [ ] **Step 2: Specs e READMEs:** desvios encontrados nas Tasks 1-8 (resposta do servidor às regras de `$users`; `sendCommand` com admin ou não; o que mudou em `entradas.test.ts`); remover menções à campainha.
- [ ] **Step 3: Verificar** a suíte de cada pacote tocado uma vez: `cd pacotes/instant && bun run test`, `cd worker && bun run test`, `cd app && bun run test && bun run check`, `cd mcp && bun run test`.
- [ ] **Step 4: Commit** `docs: migração para o instant-commands e roteiro do corte`.
