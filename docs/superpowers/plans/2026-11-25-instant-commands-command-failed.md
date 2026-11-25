# `instant-commands`: evento `command.failed` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emitir `{ type: "command.failed", command, commandId, error }` no máximo uma vez por command, só quando ele termina `failed` de fato, para que o app reaja à falha sem confundir com os diagnósticos de `run.failed`.

**Architecture:** Tudo em `src/worker/execution.ts`. Um helper interno emite `command.failed` quando `markFailed` devolve `written: true`, chamado em cada caminho que grava `failed` (`ic:fail`, `ic:check`, step limit e o fallback dele), e no `ic:finish` quando o registro relido já está `failed`. `run.failed` não muda.

**Tech Stack:** Bun 1.4.5, TypeScript 5.9.3, `@instantdb/admin` 1.0.67, `openworkflow` 0.11.0.

**Spec:** `docs/superpowers/specs/2026-11-25-migracao-instant-commands-design.md`, seção "Pré-requisito na biblioteca: evento `command.failed`" (ler a seção inteira antes). Contexto: `pacotes/instant-commands/README.md` (eventos de `onEvent`, "How a command ends").

## Global Constraints

- Tudo em `pacotes/instant-commands`. Código, nomes, mensagens e testes em inglês. Commits em português, Conventional Commits, escopo `commands`, com as linhas de atribuição da sessão.
- O evento usa só chaves existentes: `type`, `command`, `commandId`, `error`. `execucao.test.ts` confere as chaves em `EVENT_KEYS`.
- `error` do `command.failed` = a mensagem **gravada** no command (`ic.fail` → a mensagem do handler; os outros caminhos → `defaultErrorMessage`; `failCommand` do handler → o `error` relido). Nunca a mensagem da exceção.
- Emitido no máximo uma vez por command: só depois de `markFailed` → `written: true`, ou no `ic:finish` com o registro relido `failed`. Nunca em soluço de disparo, erro de varredura, command apagado ou já terminado, nem para irmãs marcadas com `failCommand`.
- `run.failed` e todos os outros eventos continuam exatamente como estão; os testes existentes passam sem alteração.
- Rodar testes de `pacotes/instant-commands`: `bun run test:one <caminho>`; suíte completa `bun run test` (inclui `tsc` e integração contra o app de teste remoto). Typecheck: `bunx tsc --noEmit -p .`. Nunca escrever `.env` num comando de shell.

## Review Focus

1. **Replay depois de gravar:** `markFailed` devolve `written: false` e nada é emitido de novo. Coberto pelo teste de unidade "already failed → no command.failed" (Task 1).
2. **`onFailure` que lança ou é recusado:** o command foi gravado `failed`, então `command.failed` sai uma vez, além do `run.failed` com prefixo `onFailure`. Teste na Task 1.
3. **Step limit com gravação falhando:** se a gravação com extras falha e o fallback grava, `command.failed` sai uma vez; se o fallback também falha, não sai. Testes de unidade na Task 1.
4. **Handler que falha a si mesmo com `failCommand` e depois lança:** o registro já está `failed`; o `ic:fail` não grava (`written: false`) e o `ic:finish` não roda. Deve sair **exatamente um** `command.failed`? Não: nesse caminho nenhum ponto vê "gravei" nem "relido failed no finish". Aceito e documentado na Task 2 (o handler que usa `failCommand` em si mesmo deveria retornar, não lançar). Teste na Task 1 fixa o comportamento.
5. **Ordem dos eventos:** `command.failed` vem depois do `run.failed`/`run.invalid_input` do mesmo caminho, e antes do `run.failed` extra do `onFailure`.

---

### Task 1: Emitir `command.failed`

**Files:**
- Modify: `pacotes/instant-commands/src/worker/execution.ts`
- Test: `pacotes/instant-commands/src/worker/execution.test.ts` (unidade, step limit), `pacotes/instant-commands/testes/integracao/execucao.test.ts`

**Interfaces:**
- Produces: `RunnerEvent["type"]` passa a incluir `"command.failed"` (exportado por `instant-commands/worker` via o tipo existente). Internamente: `reportFailed(result: MarkFailedResult, commandId: string, message: string): void`, que emite `{ type: "command.failed", command: command.name, commandId, error: message }` se `result.written`, e em seguida o `run.failed` extra de `extrasError` (absorvendo o `reportExtras` atual, para fixar a ordem do Review Focus 5).

Ordem por caminho (o evento do caminho primeiro, depois `reportFailed`):

| Caminho | Evento do caminho | Depois |
|---|---|---|
| `ic:fail` (`fail`, `error`, `invalid_result`) | `run.failed` | `reportFailed(result, id, message)` |
| `ic:check` (`invalid_input`) | `run.invalid_input` | `reportFailed(result, id, defaultErrorMessage)` |
| step limit, gravação ok | `run.failed` (erro original) | `reportFailed(result, id, defaultErrorMessage)` |
| step limit, fallback ok | `run.failed` (erro da gravação) | `command.failed` se o fallback devolveu `written: true`, depois `run.failed` (erro original) |
| `ic:finish` com registro relido `failed` | `run.failed` | `command.failed` com `error: record.error ?? defaultErrorMessage` |

- [ ] **Step 1: Escrever os testes que falham.**

  Unidade, em `execution.test.ts`, no `describe("step limit")` existente (mesmo fake engine/db):
  - nos quatro testes atuais, acrescentar as asserções sobre `command.failed`: gravação ok → um `{ type: "command.failed", command, commandId, error: DEFAULT }`; fallback ok → um; os dois falham → nenhum; sem gancho e gravação falhando → nenhum;
  - `"already failed → no command.failed"`: o db falso devolve o registro com `status: "failed"`; nenhum `command.failed`.

  Integração, em `execucao.test.ts`, num `describe("command.failed")`, usando `rodar()` e `novoCommand()` existentes; um helper `failedEvents(events, cid)` filtra `type === "command.failed"`:
  - `"fail('msg') → one command.failed with error 'msg'"`;
  - `"step that exhausts retries → one command.failed with the default message"` (política curta, como o teste existente);
  - `"invalid returned result → one command.failed"`;
  - `"stored input invalid → one command.failed"` (truque `sortearNovo` existente);
  - `"handler fails itself with failCommand and returns → one command.failed with that error"` (`error === "own"`);
  - `"handler fails itself with failCommand and then throws → no command.failed"` (fixa o Review Focus 4);
  - `"onFailure that throws → one command.failed, after the run.failed and before the 'onFailure: ' run.failed"` (confere a ordem pelos índices em `events`);
  - `"done command → no command.failed"`; `"command deleted mid-run → no command.failed"` (reutilizar o padrão do teste "command deleted mid-run");
  - no teste existente do step limit (60 s), acrescentar `expect(failedEvents(events, cid)).toHaveLength(1)`. Não criar outro teste longo.
  Cada caso confere `toHaveLength(1)` (ou 0) e o `error` exato.

- [ ] **Step 2: Rodar e ver falhar.** `bun run test:one src/worker/execution.test.ts testes/integracao/execucao.test.ts`.

- [ ] **Step 3: Implementar** o tipo em `RunnerEvent`, `reportFailed` no lugar de `reportExtras` e as chamadas da tabela.

- [ ] **Step 4: Rodar e ver passar.** O mesmo comando; depois `bun run test` (suíte completa, `tsc` limpo).

- [ ] **Step 5: Commit** `feat(commands): evento command.failed quando o command termina failed`.

---

### Task 2: Documentação

**Files:**
- Modify: `pacotes/instant-commands/README.md`
- Modify: `docs/superpowers/specs/2026-11-25-instant-commands-design.md`
- Modify: `docs/superpowers/specs/2026-11-25-migracao-instant-commands-design.md` (só a seção do pré-requisito: marcar como implementado e registrar desvios, se houver)

- [ ] **Step 1: README.** Na lista de eventos de `onEvent`, acrescentar `command.failed`. Um parágrafo curto: é o sinal para reagir à falha de um command (fechar uma tela, alertar), emitido no máximo uma vez, só quando o command termina `failed`, com `error` = a mensagem gravada; `run.failed` é diagnóstico (também dispara em soluços de disparo e de varredura, pode repetir e carrega a mensagem técnica). Dizer quando ele não sai: command apagado ou já terminado, irmãs marcadas com `failCommand`, handler que se marca `failed` com `failCommand` e depois lança (recomendar retornar). Dizer que o evento pode se perder se o processo cair entre a gravação e a emissão. Atualizar o bullet de `onFailure` que manda filtrar o prefixo `onFailure`: indicar `command.failed` como o jeito simples. Um exemplo curto de `onEvent` que reage a `command.failed`.

- [ ] **Step 2: Spec principal.** Na seção do runner/eventos, acrescentar `command.failed` à lista com uma linha, e uma entrada em "Status da implementação e desvios".

- [ ] **Step 3: Spec da migração.** Na seção "Pré-requisito na biblioteca", acrescentar "**Status:** implementado (commits …)" e qualquer desvio (o caso do Review Focus 4).

- [ ] **Step 4: Verificar.** `bun run test` em `pacotes/instant-commands` (o README não tem exemplo compilado novo obrigatório; se o exemplo de `onEvent` entrar em `testes/tipos/readme.ts`, ele precisa compilar).

- [ ] **Step 5: Commit** `docs(commands): evento command.failed no README e nas specs`.
