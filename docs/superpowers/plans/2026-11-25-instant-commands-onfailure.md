# `instant-commands`: gancho `onFailure` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar a `defineHandler` a opção `onFailure`, que acrescenta trechos de transação à mesma transação em que a biblioteca grava `failed`, em todos os caminhos de falha.

**Architecture:** `markFailed` (em `src/worker/status.ts`) passa a aceitar uma função `extras(record)` chamada só quando o command existe e está aberto. Ela grava `[failedChunk, ...extras]` num único `transact`, com fallback para só o `failedChunk` quando o gancho lança ou o Instant recusa a transação (4xx). `execution.ts` monta essa função a partir de `handler.options.onFailure` em cada um dos cinco caminhos (`fail`, `error`, `invalid_result`, `invalid_input`, `step_limit`) e emite um `run.failed` extra quando os extras foram descartados.

**Tech Stack:** Bun 1.4.5, TypeScript 5.9.3, `@instantdb/admin` 1.0.67, `openworkflow` 0.11.0.

**Spec:** `docs/superpowers/specs/2026-11-25-instant-commands-onfailure-design.md` (ler inteira antes de qualquer tarefa). Contexto: `pacotes/instant-commands/README.md`, seção "How a command ends".

## Global Constraints

- Tudo dentro de `pacotes/instant-commands`. Código, nomes, mensagens e testes em **inglês**. Commits em português, Conventional Commits, escopo `commands` (`feat(commands): …`), com as linhas de atribuição da sessão.
- Sem `onFailure`, nada muda: os testes existentes passam sem alteração, exceto as asserções de retorno de `markFailed` ajustadas na Task 2.
- O gancho **devolve** `TransactionChunk[]` (ou `Promise` disso); só a biblioteca chama `db.transact`.
- Mensagens dos eventos extras, exatas: `"onFailure: <mensagem>"` (o gancho lançou ou não devolveu um array) e `"onFailure rejected: <mensagem>"` (o Instant recusou a transação com os extras).
- Mensagem da validação em `defineHandler`, exata: `CommandDefinitionError(command.name, ["options.onFailure: must be a function"])`.
- Recusa do Instant = `err.name === "InstantAPIError"` com `400 <= err.status < 500`, exceto `408` e `429`. Qualquer outro erro do `transact` propaga.
- Eventos só usam as chaves já existentes (`type`, `command`, `commandId`, `count`, `error`, `fields`). `execucao.test.ts` confere isso em `EVENT_KEYS`.
- Testes de integração seguem a higiene do pacote: `novoPrefixo`, `limpar(PREFIXO)` no `afterAll`, `limparRestos` no `beforeAll`, um usuário novo por command criado (`novoCommand()` já faz isso).
- Rodar um arquivo de teste: `cd pacotes/instant-commands && bun run test:one <caminho>` (script criado na Task 1). Suíte completa: `bun run test`. Nunca escrever `.env` num comando de shell: um hook o recusa; o caminho do env fica só no `package.json`.

## Review Focus

1. **Replay do `ic:fail` depois de gravar:** o gancho não pode ser chamado de novo quando o command já está `failed`. Coberto pelo teste "not called when already failed" (Task 2), porque o replay passa pelo mesmo `markFailed`.
2. **O handler falha a si mesmo com `failCommand` num `transact` próprio e retorna:** o gancho **não** roda (o `ic:finish` só registra). Teste na Task 3.
3. **Gancho assíncrono que rejeita** (ex.: `db.query` falhando dentro dele): `failed` gravado sem extras, mais `run.failed` com `"onFailure: …"`. Teste na Task 2.
4. **Trecho recusado pelo Instant** (violação de `unique`): o command termina `failed` e o campo fica intacto. Teste de integração na Task 2.
5. **`invalid_input` com campos faltando:** o gancho recebe só os campos presentes, sem lançar. Teste na Task 3.

---

### Task 1: Tipos, opção em `defineHandler` e script `test:one`

**Files:**
- Modify: `pacotes/instant-commands/package.json` (scripts)
- Modify: `pacotes/instant-commands/src/worker/handler.ts`
- Modify: `pacotes/instant-commands/src/worker/init.ts`
- Modify: `pacotes/instant-commands/src/worker/index.ts`
- Test: `pacotes/instant-commands/src/worker/handler.test.ts`, `pacotes/instant-commands/testes/tipos/handler.ts`

**Interfaces:**
- Produces (em `handler.ts`, exportados por `src/worker/index.ts`):
  ```ts
  export type FailureReason = "fail" | "error" | "invalid_result" | "invalid_input" | "step_limit";
  type FailureBase<S> = { db: InstantAdminDatabase<S>; error: string };
  export type FailureContext<C extends Command, S extends InstantSchemaDef<any, any, any> = InstantUnknownSchema> =
    | (FailureBase<S> & { reason: Exclude<FailureReason, "invalid_input">; command: CommandRecord<C> })
    | (FailureBase<S> & { reason: "invalid_input"; command: { id: CommandId<C> } & { [K in keyof FieldValues<C>]?: unknown } });
  export type FailureHook<C extends Command, S ...> =
    (ctx: FailureContext<C, S>) => TransactionChunk<any, any>[] | Promise<TransactionChunk<any, any>[]>;
  export type HandlerOptions<C extends Command = Command, S ... = InstantUnknownSchema> = {
    version?: string; retryPolicy?: RetryPolicy; defaultErrorMessage?: string; onFailure?: FailureHook<C, S>;
  };
  ```
  `Handler<C, S>.options` passa a ser `HandlerOptions<C, S>`; `defineHandler(command, fn, options?: HandlerOptions<C, S>)`; o `defineHandler` de `initCommands` aceita `options?: HandlerOptions<C, S>`.

- [ ] **Step 1: Adicionar o script** `"test:one": "bun --env-file=../../.env test"` em `package.json`. Rodar `bun run test:one src/worker/handler.test.ts`. Esperado: os testes atuais passam.

- [ ] **Step 2: Escrever os testes que falham**

  Em `handler.test.ts`, no `describe("defineHandler")`:
  ```ts
  test("keeps onFailure in options", () => {
    const onFailure = () => [];
    expect(defineHandler(sortear, async () => {}, { onFailure }).options.onFailure).toBe(onFailure);
  });
  test("rejects an onFailure that is not a function", () => {
    expect(() => defineHandler(sortear, async () => {}, { onFailure: "x" as any })).toThrow(CommandDefinitionError);
    try { defineHandler(sortear, async () => {}, { onFailure: 1 as any }); }
    catch (e) { expect((e as CommandDefinitionError).problems).toEqual(["options.onFailure: must be a function"]); }
  });
  ```
  Em `testes/tipos/handler.ts`:
  ```ts
  defineHandler(sortear, async () => {}, {
    onFailure: (ctx) => {
      if (ctx.reason === "invalid_input") {
        yes<Eq<typeof ctx.command.chave, unknown>>();
        return [];
      }
      yes<Eq<typeof ctx.command.chave, string>>();
      yes<Eq<typeof ctx.error, string>>();
      return [ctx.db.tx.sorteios[ctx.command.id]!.update({ chave: `${ctx.command.chave}:erro` })];
    },
  });
  // @ts-expect-error must return transaction chunks
  defineHandler(sortear, async () => {}, { onFailure: () => "x" });
  // async hook is accepted
  defineHandler(sortear, async () => {}, { onFailure: async () => [] });
  ```
  Adicionar o mesmo bloco de tipos usando o `defineHandler` de `ic.initCommands<AppSchema>()` (o `AppSchema` de `testes/app/schema.ts`), conferindo que `ctx.db` é `InstantAdminDatabase<AppSchema>`.

- [ ] **Step 3: Rodar e ver falhar.** `bun run test:one src/worker/handler.test.ts` (FAIL: `CommandDefinitionError` não lançado) e `npx tsc --noEmit -p pacotes/instant-commands` (erros nos testes de tipo).

- [ ] **Step 4: Implementar** os tipos do bloco Interfaces em `handler.ts`, a validação em `defineHandler` (lançar se `options.onFailure !== undefined && typeof options.onFailure !== "function"`), a assinatura em `init.ts` e os `export type { FailureContext, FailureHook, FailureReason }` em `index.ts`.

- [ ] **Step 5: Rodar e ver passar.** O mesmo `test:one` e `tsc --noEmit -p .` em `pacotes/instant-commands`. Esperado: PASS e nenhum erro de tipo.

- [ ] **Step 6: Commit** `feat(commands): opção onFailure em defineHandler (tipos e validação)`.

---

### Task 2: `markFailed` com extras na mesma transação

**Files:**
- Modify: `pacotes/instant-commands/src/worker/status.ts`
- Create: `pacotes/instant-commands/src/worker/status.test.ts` (unidade, db falso)
- Modify: `pacotes/instant-commands/testes/integracao/status.test.ts`

**Interfaces:**
- Consumes: nada da Task 1 (status.ts não conhece o gancho; recebe uma função genérica).
- Produces:
  ```ts
  export type FailureExtras = (record: Record<string, any>) => Promise<TransactionChunk<any, any>[]>;
  export type MarkFailedResult = { written: boolean; extrasError?: string };
  export async function markFailed(db, command, id, message, extras?: FailureExtras): Promise<MarkFailedResult>;
  export function isInstantRejection(error: unknown): boolean; // regra das Global Constraints
  ```
  Ordem obrigatória dentro de `markFailed`: `find`; se não existe ou não está aberto → `{ written: false }`, **sem chamar `extras`**; senão `chunks = await extras(row)` (lançou, ou não é array → `chunks = []` e `extrasError = "onFailure: <msg>"`); `transact([failedChunk, ...chunks])`; se lançou, `chunks.length > 0` e `isInstantRejection(e)` → `transact([failedChunk])` e `extrasError = "onFailure rejected: <msg>"`; senão relança. O `row` passado a `extras` é o registro inteiro lido pelo `find` (com campos padrão); quem filtra os campos é a Task 3.

- [ ] **Step 1: Escrever os testes de unidade que falham** em `src/worker/status.test.ts`, com um db falso `{ query: async () => ({ sorteios: rows }), transact: mock }` e o `sortear` de `testes/app/commands`:
  - `"calls extras with the stored record and writes failed + extras in ONE transact"`: um único `transact`, argumento com 2 trechos, o 1º com `status: "failed"`; `extras` recebeu o registro;
  - `"does not call extras when the command is absent / done / failed"` (três casos; `written: false`, `extras` não chamado, nenhum `transact`);
  - `"extras that throws → failed written alone, extrasError 'onFailure: boom'"`;
  - `"extras that returns a non-array → failed alone, extrasError starts with 'onFailure: '"`;
  - `"rejected transact (InstantAPIError 400) with extras → retries with failed only, extrasError 'onFailure rejected: …'"`: o 1º `transact` lança `Object.assign(new Error("not unique"), { name: "InstantAPIError", status: 400 })`, e o 2º recebe só o `failedChunk`;
  - `"network error on transact propagates and is not retried"`: lança `new TypeError("fetch failed")`, `markFailed` rejeita, um só `transact`;
  - `"429 is not a rejection"`: `isInstantRejection({ name: "InstantAPIError", status: 429 })` é `false`; `400` é `true`; `500` é `false`.

- [ ] **Step 2: Escrever o teste de integração que falha** em `testes/integracao/status.test.ts`:
  - `"markFailed with extras frees a unique field in the same write"`: cria um sorteio com `chave = <PREFIXO>-X`, marca `running`, chama `markFailed(admin, sortear, id, "m", async (r) => [tx.sorteios[id].update({ chave: `${r.chave}:erro:${id}` })])`, confere `status: "failed"`, `error: "m"`, `chave` renomeada; depois cria outro sorteio com a chave original (`sendCommand` com usuário novo) e espera sucesso;
  - `"markFailed with a rejected extra (unique clash) → failed, field untouched"`: o extra muda a `chave` para a chave de outro sorteio existente; confere `failed`, `chave` original e `extrasError` começando por `"onFailure rejected: "`. **Este teste confirma a regra 4xx contra o servidor real**: se o Instant devolver outro status para violação de `unique`, ajustar `isInstantRejection` e registrar na seção de desvios da spec (Task 4);
  - ajustar as asserções existentes de `markFailed` (`false`/`true` → `.written`).

- [ ] **Step 3: Rodar e ver falhar.** `bun run test:one src/worker/status.test.ts testes/integracao/status.test.ts`.

- [ ] **Step 4: Implementar** `markFailed`, `isInstantRejection` e os tipos em `status.ts`. Atualizar os chamadores em `execution.ts` só para compilar (eles ainda não passam `extras`; o retorno não era usado).

- [ ] **Step 5: Rodar e ver passar.** O mesmo comando, mais `bun run test:one testes/integracao/execucao.test.ts` (sem regressão).

- [ ] **Step 6: Commit** `feat(commands): markFailed grava extras na mesma transação, com fallback`.

---

### Task 3: Ligar o gancho nos cinco caminhos de falha

**Files:**
- Modify: `pacotes/instant-commands/src/worker/execution.ts`
- Test: `pacotes/instant-commands/testes/integracao/execucao.test.ts`

**Interfaces:**
- Consumes: `HandlerOptions.onFailure`, `FailureReason` (Task 1); `markFailed(..., extras)`, `MarkFailedResult` (Task 2).
- Produces: nada exportado. Internamente, `extrasFor(reason: FailureReason, message: string): FailureExtras | undefined` monta o `ctx`: `command = { id: commandId, ...<só as chaves de command.fields presentes no registro> }`, `error = message`, `db`, `reason`. `failStep(reason, message, error)` passa a receber o `reason`.

Mapa dos caminhos (o `error` passado ao gancho é a mensagem gravada):

| Caminho em `execution.ts` | `reason` |
|---|---|
| `isCommandFailure(e)` no catch do handler | `"fail"` |
| catch genérico (passo esgotado, exceção) | `"error"` |
| `finish.outcome === "invalid_result"` | `"invalid_result"` |
| `problems.length > 0` dentro do `ic:check` | `"invalid_input"` |
| `isStepLimitExceeded(e)` no `engine.define` | `"step_limit"` |

Quando `markFailed` devolve `extrasError`, emitir **mais um** `{ type: "run.failed", command, commandId, error: extrasError }`, além do evento que o caminho já emite.

- [ ] **Step 1: Escrever os testes que falham** em `execucao.test.ts`, num `describe("onFailure")`. Cada teste usa um gancho que registra os `ctx` recebidos (`const seen: FailureContext<typeof sortear>[] = []`) e devolve o trecho que renomeia a `chave` para `${ctx.command.chave}:erro:${ctx.command.id}`:
  - `"step that exhausts retries → hook frees the chave; a new command with the same chave is accepted"`: passo que sempre lança, com `step.run({ name: "x", retryPolicy: { maximumAttempts: 2, initialInterval: "10ms" } }, …)` (seguir a política curta do teste existente "step that exhausts retries"). Confere `failed`, `error === DEFAULT_ERROR`, `chave` renomeada, `seen[0].reason === "error"`, `seen[0].error === DEFAULT_ERROR`, e que `sendCommand` com a chave original (usuário novo, mesmo grupo não é necessário) resolve;
  - `"fail('msg') → hook gets reason 'fail' and error 'msg'"`;
  - `"invalid returned result → reason 'invalid_result'"`;
  - `"stored input invalid → reason 'invalid_input', command has only present fields"`: reutilizar o truque do `sortearNovo` do teste existente; confere `seen[0].command.prioridade === undefined` e `seen[0].command.chave` presente;
  - `"handler fails itself with failCommand in its own transact → hook not called"`: `await db.transact(failCommand(sortear, command.id, "own"))` e retorna; confere `failed`, `error === "own"` e `seen.length === 0`;
  - `"hook that throws → failed with the original error, plus run.failed 'onFailure: …'"`: confere o registro e um evento com `error` começando por `"onFailure: "`;
  - `"done command → hook not called"`: handler feliz; `seen.length === 0`;
  - **step limit:** no teste existente `"handler past the step limit…"`, passar um `onFailure` que registra os `reason` e acrescentar `expect(reasons).toEqual(["step_limit"])`. Não criar outro teste de 60 s.

- [ ] **Step 2: Rodar e ver falhar.** `bun run test:one testes/integracao/execucao.test.ts`.

- [ ] **Step 3: Implementar** `extrasFor` e o `reason` em `failStep`, e passar `extras` nos cinco caminhos da tabela.

- [ ] **Step 4: Rodar e ver passar.** O mesmo comando; depois a suíte inteira, `bun run test` em `pacotes/instant-commands`. Esperado: tudo PASS e `tsc` limpo.

- [ ] **Step 5: Commit** `feat(commands): onFailure roda em todos os caminhos de falha`.

---

### Task 4: Documentação

**Files:**
- Modify: `pacotes/instant-commands/README.md` ("How a command ends" e a tabela de `defineHandler`)
- Modify: `docs/superpowers/specs/2026-11-25-instant-commands-design.md` ("Como o command termina": uma linha apontando para a spec do gancho)
- Modify: `docs/superpowers/specs/2026-11-25-instant-commands-onfailure-design.md` (status → "implementado", nova seção final "Status da implementação e desvios")
- Test: `pacotes/instant-commands/testes/tipos/readme.ts` (o exemplo do README compila)

- [ ] **Step 1: README.** Em "How a command ends", acrescentar um item `onFailure`: o que recebe (`db`, `command`, `reason`, `error`), que devolve trechos e nunca chama `db.transact`, que pode rodar mais de uma vez (replay) e por isso não deve ter efeitos colaterais, os dois fallbacks com suas mensagens de evento, e que não roda quando o próprio handler grava a falha com `failCommand`. Trocar a recomendação: `ic.fail` para a própria falha, `failCommand` só para *outros* commands. Incluir o exemplo `liberarChave` da spec (adaptado ao `draws` do README: liberar um campo `unique` hipotético, ou um exemplo genérico curto) e espelhá-lo em `testes/tipos/readme.ts`.

- [ ] **Step 2: Specs.** Linha na spec principal; status e seção de desvios na spec do gancho. Desvios conhecidos: testes de `execution` são de integração (padrão do pacote), não de unidade; e qualquer ajuste em `isInstantRejection` descoberto na Task 2.

- [ ] **Step 3: Verificar.** `bun run test` em `pacotes/instant-commands`. Esperado: PASS, `tsc` limpo.

- [ ] **Step 4: Commit** `docs(commands): onFailure no README e nas specs`.
