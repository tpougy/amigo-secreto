# instant-commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir o pacote `instant-commands` (workspace `pacotes/instant-commands`): commands duráveis sobre o Instant, com ficha declarativa, schema e regras gerados, cliente tipado e um runner no worker (OpenWorkflow) avisado por webhook (padrão) ou por assinatura.

**Architecture:** A ficha (`defineCommand`) é um objeto de dados importável pelo navegador. Funções puras leem a ficha e geram entidades, links e regras (`commandEntities`, `commandLinks`, `mergePerms`). O cliente grava o command e acompanha o status pelo Instant. No worker, `initCommands<AppSchema>()` devolve `defineHandler` e `createRunner`. O runner registra os workflows num motor interno (adaptador do OpenWorkflow), recebe avisos (webhook ou assinatura, mais varreduras), dispara runs com chave = id do command, e cada run passa por checagem de status → handler → finalização.

**Tech Stack:** Bun 1.4.5, TypeScript 6.0.3 (`tsc --noEmit` para os testes de tipo), `@instantdb/core` e `@instantdb/admin` 1.0.67 (inclui `db.webhooks`), `openworkflow` 0.11.0 (SQLite), `@standard-schema/spec` (só tipos), `zod` 4.6.7 só nos testes.

**Spec:** `docs/superpowers/specs/2026-11-25-instant-commands-design.md` (ler inteira antes de qualquer tarefa; este plano argumenta a partir dela).

## Global Constraints

- Pacote: `pacotes/instant-commands`, `"name": "instant-commands"`, `"private": true`, `"type": "module"`, `exports` apontando direto para `.ts` (sem build), como `pacotes/instant/package.json`.
- Pontos de entrada: `.` → `src/index.ts`, `./schema` → `src/schema.ts`, `./perms` → `src/perms.ts`, `./client` → `src/client.ts`, `./worker` → `src/worker/index.ts`. Nada em `src/index.ts`, `src/schema.ts`, `src/perms.ts`, `src/client.ts` (nem no que eles importam) pode importar `@instantdb/admin`, `openworkflow` ou `src/worker/**`.
- Versões fixas, sem `^`: `@instantdb/core` `1.0.67`, `@instantdb/admin` `1.0.67`, `openworkflow` `0.11.0`, `typescript` `6.0.3`, `@types/bun` `1.4.5`, `zod` `4.6.7`, `@standard-schema/spec` na versão estável atual (fixar a exata).
- `tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "include": ["**/*.ts"] }`.
- Código, nomes, mensagens de erro e testes da biblioteca em **inglês** (pacote publicável). Commits em português, Conventional Commits, escopo `commands`: `feat(commands): …`.
- Status: exatamente `"pending" | "running" | "done" | "failed"`. Campos padrão: `status`, `error`, `result`, `attempts`, `createdAt`, `finishedAt`. Nomes reservados em `fields`: esses seis mais `id`.
- `defaultErrorMessage` padrão: `"Could not complete the command"`.
- Rate limit: chave em `$rateLimits` = `entity`; o trecho `rateLimit.<entity>.limit(auth.id)` vem **primeiro** no `create`.
- Webhook: ação `create` só; nunca responder `410`; erro ao disparar → `503`; assinatura inválida → `401`; corpo acima de `maxBodyBytes` → `413`. Padrões: `port` = `process.env.PORT` ou `3000`, `healthPath` `/health`, `sweepEveryMs` `300_000`, `maxBodyBytes` `65_536`, caminho da rota = caminho de `publicUrl`. Convenção de documentação: `/ic/hook`.
- Assinatura: `resubscribeEveryMs` padrão `600_000`; backoff `[1000, 2000, 5000, 10000, 30000]`.
- Nunca usar nem documentar `INSTANT_WEBHOOK_ALLOW_INSECURE`.
- `fail` é função de módulo com retorno `never` declarado; não existe `fail` no contexto do handler.
- Eventos do `onEvent` nunca carregam campos do command além do id; mensagens de exceção vão só para o `onEvent`, nunca para o banco.
- Testes de integração da biblioteca usam um app Instant dedicado, `instant-commands-teste`, em `https://instant.tpou.gy`, com `IC_TEST_APP_ID` / `IC_TEST_ADMIN_TOKEN` no `.env` da raiz. Nunca usar os apps do amigo-secreto.
- Script `test` do pacote: `tsc --noEmit -p . && bun --env-file=../../.env test src testes/integracao` (o e2e da Task 17 fica de fora por caminho).
- Higiene do app de teste compartilhado: todo teste de integração cria dados com `novoPrefixo`, apaga por prefixo no `afterAll` **e** apaga restos de prefixos `t*` com mais de 1 hora no `beforeAll`; afirma sobre os próprios ids, nunca sobre totais; usa **um usuário novo por teste** que cria commands (o rate limit gasta tokens até em tentativas negadas).

## Review Focus

1. **Command apagado no meio do run** (grupo apagado em cascata enquanto o handler roda): nenhuma escrita da biblioteca (`running`, `failed`, `done` automático) recria o registro como fantasma. Teste em Task 11 e Task 12.
2. **Step que esgota as tentativas** (rede caída): o command termina `failed` com `defaultErrorMessage`, e a mensagem real só aparece no `onEvent`. Teste em Task 12.
3. **Mesmo command avisado várias vezes** (webhook repetido + varredura + assinatura): um run só, e um aviso de command já `done` não reexecuta. Teste em Task 13.
4. **Aviso de webhook forjado ou de outro app** (assinatura inválida, namespace sem handler, ação `update`/`delete`): `401` ou `200` sem disparo, nunca exceção nem `410`. Teste em Task 15.
5. **Dados de um formato antigo** (registro gravado antes de mudar `fields` ou `result`): o worker marca `failed` com `run.invalid_input`; o cliente entrega `result: null` com `resultIssues`, sem lançar. Testes em Task 9 e Task 12.

---

## Mapa de arquivos

```
pacotes/instant-commands/
  package.json, tsconfig.json, README.md
  src/
    index.ts              defineCommand + tipos públicos (reexporta de command.ts)
    command.ts            CommandSpec, Command, defineCommand, validação da ficha
    cel.ts                checagens de texto das expressões CEL
    fields.ts             campos padrão, nomes reservados, validateInput
    result.ts             Standard Schema / i.json, validateResult
    types.ts              Jsonify, CommandId, InputOf, ResultOf, ResultInputOf, CommandState, utilitários de erro de tipo
    errors.ts             CommandDefinitionError, CommandInputError, CommandResultError
    schema.ts             commandEntities, commandLinks
    perms.ts              mergePerms
    client.ts             sendCommand, subscribeCommand, waitForCommand
    worker/
      index.ts            initCommands, defineSchedule, fail, failCommand, tipos
      engine.ts           interface Engine + openWorkflowEngine(ow)
      step.ts             Step (run com ...args e Jsonify)
      status.ts           escritas de status sem fantasma
      handler.ts          defineHandler, HandlerContext, fail, failCommand, CommandFailure
      execution.ts        workflow de um command: checagem → handler → finalização
      dispatch.ts         dispatchCommand (cadeia de retry) e sweep
      subscription.ts     aviso por assinatura (extraído de worker/nucleo/campainha.ts)
      webhook.ts          createWebhookHandler, ensureWebhook
      server.ts           servidor Bun.serve embutido
      schedule.ts         defineSchedule
      runner.ts           createRunner, RunnerEvent
      init.ts             initCommands
  testes/
    app/schema.ts, app/perms.ts, app/commands.ts   app de teste (fixture)
    helpers.ts            adminIC(), clienteIC(), novoPrefixo, esperarAte, owTemporario()
    push-app-teste.sh
    tipos/*.ts            testes de tipo (só tsc)
    integracao/*.test.ts
    e2e/                  worker e2e do Task 17
```

Testes unitários ficam ao lado do código (`src/**/*.test.ts`); integração em `testes/integracao/`.

---

### Task 1: Teste de hairpin na VPS (pré-requisito do modo webhook)

**Files:**
- Create: `docs/spikes/hairpin-webhook.md`
- Create (descartável, apagado no fim): app Dokku `ic-eco` com `docs/spikes/hairpin/eco.ts` e `docs/spikes/hairpin/Dockerfile`
- Este spike usa o app `amigo-secreto-teste` (entidade `grupos`) só para provocar uma entrega; é a única exceção à regra de não usar os apps do amigo-secreto, porque o app `instant-commands-teste` só nasce no Task 2.

**Interfaces:**
- Produces: o **IP de origem** visto pelo nginx para entregas do Instant, e a decisão registrada (a/b/c abaixo). Task 15, 17 e 18 leem `docs/spikes/hairpin-webhook.md`.

- [ ] **Step 1: Escrever o servidor de eco**

`docs/spikes/hairpin/eco.ts`: `Bun.serve` em `process.env.PORT` que, para `POST /ic/hook`, imprime em JSON uma linha com `headers` (`x-forwarded-for`, `x-real-ip`, `instant-signature` presente ou não) e responde `200`; `GET /health` → `ok`. `Dockerfile`: `FROM oven/bun:1.4.5`, copia só `docs/spikes/hairpin/eco.ts`, `CMD ["bun", "eco.ts"]`.

- [ ] **Step 2: Subir `ic-eco` com HTTPS** (mesmo padrão de `infra/dokku/provisionar.sh`: builder dockerfile por app)

```bash
ssh vps-mercurio 'dokku apps:create ic-eco && dokku builder:set ic-eco selected dockerfile \
  && dokku builder-dockerfile:set ic-eco dockerfile-path docs/spikes/hairpin/Dockerfile \
  && dokku domains:set ic-eco ic-eco.app.tpou.gy'
git push dokku@vps-mercurio:ic-eco HEAD:main --force
ssh vps-mercurio 'dokku letsencrypt:enable ic-eco'
curl -s https://ic-eco.app.tpou.gy/health
```
Expected: `ok`.

- [ ] **Step 3: Cadastrar um webhook no app `amigo-secreto-teste` e provocar uma entrega**

Script descartável (rodar da máquina local com `bun --env-file=.env`): `adminTeste().webhooks.manager.create({ url: "https://ic-eco.app.tpou.gy/ic/hook", namespaces: ["grupos"], actions: ["create", "update"] })`. Provocar **duas** entregas:
1. um grupo gravado com `tx.grupos[id()].update({...})` num id novo, que é como o `sendCommand` grava;
2. um grupo gravado com `.create({...})`.

Em cada uma, anotar a `action` que chega no conteúdo (`manager.getPayload`). Se o `update` num id novo **não** chegar como `create`, registrar isso no resultado: o `sendCommand` (Task 9) passa a usar `.create(...)`. Usar o prefixo `novoPrefixo("hairpin")` e apagar com `limparTudo`.

- [ ] **Step 4: Ler a origem**

```bash
ssh vps-mercurio 'dokku logs ic-eco --num 20; dokku nginx:access-logs ic-eco | tail -5'
```
Expected: uma linha do eco com `instant-signature` presente, e a linha correspondente no access log do nginx mostrando o IP de origem.

- [ ] **Step 5: Testar a regra de nginx**

Criar `/home/dokku/ic-eco/nginx.conf.d/so-a-vps.conf` com `allow <IP observado>; deny all;`, `dokku proxy:build-config ic-eco`, repetir o Step 3 e conferir: entrega chega (`200` no histórico do evento via `manager.listEvents`) e `curl -s -o /dev/null -w '%{http_code}' -X POST https://ic-eco.app.tpou.gy/ic/hook` da máquina local devolve `403`.

- [ ] **Step 6: Registrar o resultado e limpar**

`docs/spikes/hairpin-webhook.md` com: data, IP de origem observado, trecho de nginx validado, e a decisão:
(a) entrega chega e a origem é distinguível → modo webhook padrão com a regra `allow`/`deny`;
(b) entrega chega mas a origem não é distinguível → modo webhook padrão só com a assinatura;
(c) entrega não chega → o padrão do `trigger` passa a ser `subscription` (ajustar Task 16 e a spec antes de seguir).
Apagar o webhook (`manager.delete`) e o app (`dokku apps:destroy ic-eco --force`).

- [ ] **Step 7: Commit**

```bash
git add docs/spikes/hairpin-webhook.md docs/spikes/hairpin/
git commit -m "docs(spikes): hairpin de webhook do Instant na VPS"
```

---

### Task 2: Pacote, app de teste e infraestrutura de testes

**Files:**
- Create: `pacotes/instant-commands/package.json`, `tsconfig.json`, `src/index.ts` (vazio por ora: `export {};`)
- Create: `pacotes/instant-commands/testes/helpers.ts`, `testes/integracao/conexao.test.ts`
- Modify: `infra/instant/instant-apps.sh` (terceiro app `instant-commands-teste`, variáveis `IC_TEST_APP_ID`/`IC_TEST_ADMIN_TOKEN`; a contagem passa a usar `grep -c '^\(INSTANT\|IC\)_[A-Z_]*=.\+'` e esperar 7)
- Modify: `infra/instant/instant-cli.sh` (alvo `ic` → `IC_TEST_APP_ID`/`IC_TEST_ADMIN_TOKEN`)
- Modify: `.env.example` (as duas variáveis novas)

**Interfaces:**
- Produces (`testes/helpers.ts`):
  - `adminIC(): InstantAdminDatabase<TestSchema>` (schema de `testes/app/schema.ts`, criado na Task 8; até lá, `adminICSemSchema()`)
  - `adminICSemSchema(): InstantAdminDatabase<InstantUnknownSchema>`
  - `novoPrefixo(nome: string): string` → `` `t${Date.now().toString(36)}-${nome}` ``
  - `esperarAte(cond: () => Promise<boolean>, prazoMs?: number): Promise<void>` (padrão 5000, polling 100 ms)
  - `owTemporario(nome: string): { ow: OpenWorkflow; backend: BackendSqlite; arquivo: string; limpar(): Promise<void> }` (SQLite em `tmpdir()`, `limpar` para o backend e apaga `""`, `-wal`, `-shm`)

- [ ] **Step 1: Criar o app de teste**

Rodar `infra/instant/instant-apps.sh` modificado. Expected: `variáveis preenchidas: 7/7`.

- [ ] **Step 2: Escrever o teste de conexão**

```ts
test("test app answers an admin query", async () => {
  const db = adminICSemSchema();
  const r = await db.query({ $users: { $: { limit: 1 } } });
  expect(Array.isArray(r.$users)).toBe(true);
});
```

- [ ] **Step 3: Rodar e ver falhar** (`cd pacotes/instant-commands && bun run test`). Expected: FAIL, `helpers.ts` ainda não existe.

- [ ] **Step 4: Implementar `package.json`, `tsconfig.json` e `testes/helpers.ts`** conforme Global Constraints:
  - `dependencies`: `@instantdb/core`, `@instantdb/admin`, `openworkflow`, `@standard-schema/spec`;
  - `devDependencies`: `typescript`, `@types/bun`, `zod`;
  - depois, `bun install` na raiz.

- [ ] **Step 5: Rodar** (`bun run test` no pacote). Expected: `tsc` sem erros e `1 pass`.

- [ ] **Step 6: Commit** — `feat(commands): pacote instant-commands e app Instant de teste`

---

### Task 3: Ficha (`defineCommand`) e validações ao definir

**Files:**
- Create: `src/command.ts`, `src/cel.ts`, `src/fields.ts` (só constantes nesta tarefa), `src/errors.ts`, `src/types.ts` (só `InputOf` nesta tarefa)
- Modify: `src/index.ts`
- Test: `src/command.test.ts`, `src/cel.test.ts`, `testes/tipos/command.ts`

**Interfaces:**
- Produces:
  - `type LinkSpec = { forward: { on: string; has: "one"; label: string; onDelete?: "cascade" }; reverse: { on: string; has: "many"; label: string } }`
  - `type ResultSpec = DataAttrDef<any, any, any, any> | StandardSchemaV1`
  - `type CommandSpec = { name: string; entity: string; fields?: Record<string, DataAttrDef<any, any, any, any>>; links?: Record<string, LinkSpec>; bind?: Record<string, string>; allow: { create: string; view: string; delete?: string; link?: Record<string, string> }; rateLimit?: { limits: { capacity: number; refill?: { amount?: number; period?: string; type?: "interval" | "greedy" } }[] }; result?: ResultSpec }`
  - `type Command<S extends CommandSpec = CommandSpec> = S & { readonly [COMMAND_BRAND]: true }`
  - `function defineCommand<const S extends CommandSpec>(spec: S): Command<S>` (lança `CommandDefinitionError` com todos os problemas juntos)
  - `const COMMAND_STATUS = ["pending", "running", "done", "failed"] as const`, `type CommandStatus`
  - `const STANDARD_FIELDS = ["status", "error", "result", "attempts", "createdAt", "finishedAt"] as const`, `RESERVED_FIELDS` = esses + `"id"`
  - `class CommandDefinitionError extends Error { problems: string[] }`
  - `function checkExpressions(spec: CommandSpec): string[]` (em `cel.ts`)
  - `type InputOf<C extends Command>`: `fields` obrigatórios como `V`, `.optional()` como chave opcional `V | undefined`, cada `forward.label` como `string`

- [ ] **Step 1: Escrever os testes de runtime**

```ts
// src/command.test.ts — usar a ficha `sortear` da spec (seção "A ficha") como base válida
test("valid spec returns the same data", () => { expect(defineCommand(sortear).entity).toBe("sorteios"); });
test("rejects forward.on different from entity", …toThrow(/forward\.on/));
test("rejects forward.has other than one", …);
test("rejects reserved field names", () => /* fields: { status: i.string() } */ …toThrow(/reserved/));
test("rejects allow.update and allow.unlink", …);
test("rejects allow.link keys that are not forward labels", …);
test("requires allow.delete when a link cascades", …toThrow(/allow\.delete/));
test("reports all problems at once", () => { /* duas falhas → problems.length === 2 */ });
// src/cel.test.ts
test("flags identifiers in allow missing from bind", () => expect(checkExpressions({..., allow: { create: "ehDono", view: "true" }})).toEqual([expect.stringMatching(/ehDono/)]));
test("accepts CEL vocabulary", () => /* auth, data, newData, linkedData, ruleParams, request, actions, rateLimit, true, false, null, in, size, has */ …toEqual([]));
test("flags data.ref whose first segment is not a link label or field", () => /* data.ref('group.x') com label 'grupo' */ …);
test("ignores identifiers inside string literals", () => /* "'pending' in data.ref('grupo.reaberturas.status')" */ …toEqual([]));
```

- [ ] **Step 2: Escrever os testes de tipo** (`testes/tipos/command.ts`)

```ts
const c = defineCommand({ ...sortear });
type In = InputOf<typeof c>;
const ok: In = { grupo: "g", rodada: 1, chave: "g:1" };
// @ts-expect-error missing chave
const semChave: In = { grupo: "g", rodada: 1 };
// @ts-expect-error wrong label
const labelErrado: In = { group: "g", rodada: 1, chave: "x" };
const literal: "sorteios" = c.entity; // const type parameter, sem `as const`
```
Mais um caso com `i.string().optional()`: a chave pode ser omitida.

- [ ] **Step 3: Rodar e ver falhar** (`bun run test`). Expected: erros de import.

- [ ] **Step 4: Implementar** `defineCommand`, as constantes, `CommandDefinitionError`, `checkExpressions` (identificadores fora de aspas simples ou duplas, não precedidos de `.`; vocabulário CEL fixo listado no teste mais `size`, `has`, `exists`, `all`, `map`, `filter`, `matches`, `startsWith`, `endsWith`, `contains`, `int`, `string`, `double`, `bool`, `timestamp`, `duration`; `data.ref('…')` com regex sobre o primeiro segmento) e `InputOf`. Reexportar de `src/index.ts`.

- [ ] **Step 5: Rodar.** Expected: tudo passa, incluindo `tsc`.

- [ ] **Step 6: Commit** — `feat(commands): defineCommand com validação da ficha`

---

### Task 4: Resultado (`result`) e validação de entrada em execução

**Files:**
- Create: `src/result.ts`
- Modify: `src/fields.ts`, `src/types.ts`, `src/errors.ts`
- Test: `src/result.test.ts`, `src/fields.test.ts`, `testes/tipos/result.ts`

**Interfaces:**
- Produces:
  - `type ResultOf<C extends Command>`: `T` de `i.json<T>()`, `InferOutput` do Standard Schema, ou `null` sem `result`
  - `type ResultInputOf<C extends Command>`: `T` de `i.json<T>()`, `InferInput` do Standard Schema, ou `null`
  - `function isStandardSchema(x: unknown): x is StandardSchemaV1`
  - `function validateResult<C extends Command>(command: C, value: unknown): { ok: true; value: ResultOf<C> } | { ok: false; issues: readonly { message: string; path?: readonly unknown[] }[] }` (síncrona; se o schema devolver `Promise`, lança `CommandDefinitionError("result schema must validate synchronously")`; com `i.json<T>()` ou sem `result`, devolve `ok: true` sem checar)
  - `class CommandResultError extends Error { issues }`, `class CommandInputError extends Error { problems: string[] }`
  - `function validateInput(command: Command, values: Record<string, unknown>, mode: "client" | "worker"): string[]` (`string` → `typeof "string"`; `number` → número finito; `boolean`; `date` → `Date`, número finito ou string com `Date.parse` válido; `json` → qualquer valor diferente de `undefined`; obrigatório ausente é problema; no modo `"client"`, cada `forward.label` precisa ser string não vazia)

- [ ] **Step 1: Escrever os testes**

```ts
test("zod result: valid value passes and is the parsed output", …validateResult(cmdZod, { pares: 3 })).toEqual({ ok: true, value: { pares: 3 } }));
test("zod result: invalid value returns issues", …ok false, issues.length > 0);
test("async schema throws CommandDefinitionError", …/* schema fake com ~standard.validate devolvendo Promise */);
test("i.json result is not validated at runtime", …ok true);
test("validateInput accepts a valid input", …toEqual([]));
test("validateInput reports wrong type and missing required", …/* rodada: "2", sem chave */ toHaveLength(2));
test("validateInput client mode requires link ids", …/* grupo: "" */);
test("validateInput accepts date as number, ISO string or Date", …);
```
Tipos: `ResultOf<cmdZod>` é `{ pares: number }`; `ResultOf<cmdJson>` é o `T`; `ResultOf<cmdSem>` é `null`.

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** conforme Interfaces (usar `@standard-schema/spec` só como tipo; detectar pelo campo `~standard`).
- [ ] **Step 4: Rodar.** Expected: tudo passa.
- [ ] **Step 5: Commit** — `feat(commands): result com Standard Schema e validação de entrada`

---

### Task 5: Entidades e links gerados (`commandEntities`, `commandLinks`)

**Files:**
- Create: `src/schema.ts`
- Test: `src/schema.test.ts`, `testes/tipos/schema.ts`

**Interfaces:**
- Consumes: `Command`, `STANDARD_FIELDS`, `ResultOf` (Tasks 3–4)
- Produces:
  - `function commandEntities<const Cs extends readonly Command[]>(commands: Cs & UniqueCommands<Cs>): { [C in Cs[number] as C["entity"]]: EntityDef<StandardAttrs<C> & FieldsOf<C>, {}, void> }`
  - `function commandLinks<const Cs extends readonly Command[]>(commands: Cs): LinksOf<Cs>` (as `links` de cada ficha, mescladas)
  - Atributos padrão: `status: i.string().indexed()` tipado `CommandStatus`, `error: i.string().optional()`, `result: i.json<ResultOf<C>>().optional()`, `attempts: i.number()`, `createdAt: i.date()`, `finishedAt: i.date().optional()`
  - `type UniqueCommands<Cs>`: quando há `entity` ou `name` repetido, o tipo do parâmetro vira a frase `` `commands repeat the entity "${E}"` `` (técnica da spec, seção Tipos)

- [ ] **Step 1: Escrever os testes**

```ts
test("generates standard attrs plus fields", () => {
  const e = commandEntities([sortear]).sorteios;
  expect(Object.keys(e.attrs).sort()).toEqual(["attempts","chave","createdAt","error","finishedAt","result","rodada","status"]);
  expect(e.attrs.status.config.indexed).toBe(true);
  expect(e.attrs.error.required).toBe(false);
});
test("throws on repeated entity or name", …toThrow(CommandDefinitionError));
test("commandLinks returns the declared links", …toEqual(sortear.links));
```
Tipos (`testes/tipos/schema.ts`): `i.schema({ entities: { grupos: i.entity({ titulo: i.string() }), ...commandEntities([sortear, reabrir]) }, links: { ...commandLinks([sortear, reabrir]) } })`; depois `InstaQLEntity<typeof s, "sorteios">["status"]` é `"pending" | "running" | "done" | "failed"`, `["rodada"]` é `number`; e `// @ts-expect-error` em `commandEntities([sortear, sortear])`.

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** com remapeamento de chaves (spec, seção Tipos).
- [ ] **Step 4: Rodar.** Expected: tudo passa.
- [ ] **Step 5: Commit** — `feat(commands): commandEntities e commandLinks`

---

### Task 6: Regras geradas (`mergePerms`)

**Files:**
- Create: `src/perms.ts`
- Test: `src/perms.test.ts`, `testes/tipos/perms.ts`

**Interfaces:**
- Consumes: `Command` (Task 3)
- Produces: `function mergePerms<const B extends Record<string, unknown>, const Cs extends readonly Command[]>(base: B, commands: PermsConflictCheck<B, Cs>): B & GeneratedPerms<Cs>`; com conflito, o tipo de `commands` vira `` `perms already defines "${K}", which belongs to a command` ``. Em execução, conflito lança `CommandDefinitionError`.

- [ ] **Step 1: Escrever os testes** (valores exatos da spec, seção "Regras geradas")

```ts
const p = mergePerms({ grupos: { allow: { view: "true", link: {}, unlink: {} } } }, [sortear]);
test("create puts the rate limit first and pins pending/0", () =>
  expect(p.sorteios.allow.create).toBe("rateLimit.sorteios.limit(auth.id) && (ehOrganizador && data.rodada > 0) && data.status == 'pending' && data.attempts == 0"));
test("update is false, delete comes from the spec", …toBe("false"), …toBe("ehOrganizador"));
test("command side link only on create, unlink false", () => {
  expect(p.sorteios.allow.link.grupo).toBe("actions.data == 'create' && (auth.id in linkedData.ref('organizador.id'))");
  expect(p.sorteios.allow.unlink.grupo).toBe("false");
});
test("reverse side gets link/unlink true", …p.grupos.allow.link.sorteios === "true" && unlink "true");
test("rate limit bucket under the entity key", …p.$rateLimits.sorteios toEqual(sortear.rateLimit));
test("no rateLimit in spec → no rateLimit term and no bucket", …);
test("allow.link absent → 'actions.data == 'create' && (true)'", …);
test("keeps base entries untouched, including entities outside the schema ($streams)", …);
test("throws when base already defines the command entity, the bucket or the generated link rule", …toThrow(CommandDefinitionError));
```
Tipos: o resultado é atribuível a `InstantRules<TestSchema>` quando a base é; `// @ts-expect-error` com `mergePerms({ sorteios: {...} }, [sortear])`.

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar.** Expected: tudo passa.
- [ ] **Step 5: Commit** — `feat(commands): mergePerms`

---

### Task 7: Isolamento do pacote do navegador

**Files:**
- Test: `testes/integracao/isolamento.test.ts`

**Interfaces:** nenhuma nova; protege o anti-objetivo "código do worker no navegador".

- [ ] **Step 1: Escrever o teste**

```ts
test("browser entry points do not reach worker code", async () => {
  for (const entry of ["src/index.ts", "src/schema.ts", "src/perms.ts", "src/client.ts"]) {
    const out = await Bun.build({ entrypoints: [entry], target: "browser", external: ["@instantdb/core", "@standard-schema/spec"] });
    expect(out.success).toBe(true);
    const code = await out.outputs[0]!.text();
    expect(code).not.toMatch(/@instantdb\/admin|openworkflow|bun:sqlite|Bun\.serve/);
  }
});
```
(`src/client.ts` ainda não existe: criar com `export {};` para o teste rodar; a Task 9 o preenche.)

- [ ] **Step 2: Rodar.** Expected: PASS (e continua passando nas tarefas seguintes; se falhar depois, é regressão).
- [ ] **Step 3: Commit** — `test(commands): pontos de entrada do navegador sem código do worker`

---

### Task 8: App de teste no Instant (schema e regras de verdade)

**Files:**
- Create: `testes/app/commands.ts` (fichas `sortear` e `reabrir` da spec, adaptadas: entidades `sorteios`/`reaberturas` ligadas a `grupos`; `sortear` com `result: z.object({ pares: z.number().int() })`, `reabrir` sem `result`)
- Create: `testes/app/schema.ts` (`grupos: i.entity({ titulo: i.string(), status: i.string() })`, link `grupoOrganizador` com `$users`, mais `commandEntities`/`commandLinks`; exporta `TestSchema` como o `schema.ts` do amigo-secreto faz com `AppSchema`)
- Create: `testes/app/perms.ts` (`mergePerms` sobre `grupos` com `ehOrganizador`)
- Create: `testes/push-app-teste.sh` (`INSTANT_SCHEMA_FILE_PATH`/`INSTANT_PERMS_FILE_PATH` → `infra/instant/instant-cli.sh ic push`)
- Modify: `testes/helpers.ts`:
  - `adminIC()` com `TestSchema`;
  - `novoUsuario(prefixo): Promise<{ email: string; id: string; db: InstantAdminDatabase<TestSchema> }>`, com `db = adminIC().asUser({ email })`; um por teste, por causa do rate limit;
  - `criarGrupo(prefixo, organizador)`;
  - `limpar(prefixo)`;
  - `limparRestos()`: prefixos `t*` com mais de 1 hora, para o `beforeAll`.
- Test: `testes/integracao/regras.test.ts`

**Interfaces:**
- Produces: `TestSchema`, `testes/app/commands.ts` com `sortear` e `reabrir`, helpers acima.

- [ ] **Step 1: Escrever os testes de regras** (como usuário impersonado, padrão de `pacotes/instant/testes/permissoes.*.test.ts`)

```ts
test("organizer creates a pending command linked to their group", …transact resolve);
test("cannot create with status other than pending or attempts != 0", …rejeita);
test("non-organizer cannot create", …rejeita);
test("client cannot update status", …rejeita);
test("client cannot unlink the command from the group", …rejeita);
test("organizer can delete the group and the commands cascade", …);
test("rate limit: the 6th create in the hour is refused", …/* capacity 5 */);
```

- [ ] **Step 2: Fazer o push** (`testes/push-app-teste.sh`). Expected: `instant-cli` termina sem erro.
- [ ] **Step 3: Rodar** os testes. Expected: todos passam. Se algum falhar, corrigir `mergePerms` (Task 6) com um teste unitário novo que reproduza o caso.
- [ ] **Step 4: Commit** — `test(commands): app de teste com regras geradas validadas no Instant`

---

### Task 9: Cliente (`sendCommand`, `subscribeCommand`, `waitForCommand`)

**Files:**
- Modify: `src/client.ts`, `src/types.ts`
- Test: `src/client.test.ts` (com `db` falso), `testes/integracao/cliente.test.ts`, `testes/tipos/client.ts`

**Interfaces:**
- Consumes: `InputOf`, `ResultOf`, `validateInput`, `validateResult`, `CommandInputError` (Tasks 3–4)
- Produces:
  - `type CommandId<C extends Command> = string & { readonly __command: C["name"] }`
  - `type CommandState<C extends Command> = { id: CommandId<C>; status: CommandStatus; error: string | null; result: ResultOf<C> | null; resultIssues: readonly { message: string }[] | null; attempts: number; createdAt: number; finishedAt: number | null } | null` (`null` = command sumiu)
  - `type ClientDb = { transact(chunks: unknown): Promise<unknown>; subscribeQuery(q: unknown, cb: (r: any) => void): (() => void) | { close(): void } }` (estrutural; aceita `InstantCoreDatabase` e o admin `asUser`). As diferenças entre os dois, todas tratadas:
    - cancelamento: função (core) ou `{ close() }` (admin);
    - payload: `{ data, error }` (core) ou `{ type: "ok", data } | { type: "error", error }` (admin);
    - link de um registro: pode vir ausente ou `null`, então comparar com `== null`.
    - Os chunks são montados com o `tx` exportado por `@instantdb/core`, não com `db.tx`.
  - `function sendCommand<C extends Command>(db: ClientDb, command: C, input: InputOf<C>): Promise<CommandId<C>>`
  - `function subscribeCommand<C extends Command>(db: ClientDb, command: C, id: CommandId<C>, callback: (state: CommandState<C>) => void): () => void`
  - `function waitForCommand<C extends Command>(db: ClientDb, command: C, id: CommandId<C>, options?: { timeoutMs?: number }): Promise<NonNullable<CommandState<C>>>` (padrão 30_000; resolve em `done`/`failed`; rejeita no timeout ou se o command sumir)

- [ ] **Step 1: Escrever os testes**

```ts
// unitários (db falso que grava os chunks)
test("sendCommand validates before writing", …rejects.toBeInstanceOf(CommandInputError) e nenhum transact);
test("sendCommand writes pending, attempts 0, createdAt and links", …/* inspecionar ops do chunk */);
test("subscribeCommand maps a record to CommandState", …);
test("invalid stored result arrives as result null with resultIssues", …/* result { pares: "x" } */);
test("missing record arrives as null", …);
// integração (app de teste, um organizador novo por teste)
test("send then subscribe sees pending", …);
test("core SDK path: sendCommand + subscribeCommand through @instantdb/core", …/* helper clienteCoreIC(usuario) no molde de comoCliente de pacotes/instant/testes/instant-teste.ts, com o WebSocket de INSTANT_API_URI; core transact devolve "enqueued" fora do navegador, então esperar com esperarAte */);
test("waitForCommand resolves when an admin marks done", …/* adminIC grava done + result */);
test("waitForCommand rejects on timeout", …{ timeoutMs: 300 });
```
Tipos: `// @ts-expect-error` ao passar o `CommandId<typeof sortear>` para `subscribeCommand(db, reabrir, …)`; `state.result` de `sortear` é `{ pares: number } | null`.

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** (`id()` de `@instantdb/core`).
- [ ] **Step 4: Rodar.** Expected: tudo passa, inclusive o teste de isolamento da Task 7.
- [ ] **Step 5: Commit** — `feat(commands): cliente tipado para enviar e acompanhar commands`

---

### Task 10: Motor interno e `step.run`

**Files:**
- Create: `src/worker/engine.ts`, `src/worker/step.ts`
- Modify: `src/types.ts` (`Jsonify`)
- Test: `src/worker/engine.test.ts`, `testes/tipos/step.ts`

**Interfaces:**
- Produces:
  - `type RetryPolicy = Partial<import("openworkflow").RetryPolicy>` (os intervalos são `DurationString`, não `string`)
  - `interface EngineStep { run<T>(config: { name: string; retryPolicy?: RetryPolicy }, fn: () => Promise<T> | T): Promise<T> }`
  - `function engineControlFlow(error: unknown): boolean` — `true` quando o erro **tem de voltar ao OpenWorkflow**. Fatos verificados em `openworkflow/dist/worker/execution.js` 0.11:
    - **toda** tentativa de `step.run` que falha lança um `StepError` para fora da função do workflow, e o OpenWorkflow só reagenda a tentativa se esse erro chegar ao `catch` externo dele;
    - `StaleExecutionBranchError` (lease perdido) e `SleepSignalError` também precisam passar;
    - nenhuma dessas classes é exportada: detectar por `error.name`.
    - Regra: `true` para `StaleExecutionBranchError`, `SleepSignalError` e `StepLimitExceededError`. Para `StepError`, `true` se a tentativa ainda não é a última (`retryPolicy.maximumAttempts === 0 || stepFailedAttempts < retryPolicy.maximumAttempts`). `false` caso contrário (é a falha final).
  - `function isFinalStepFailure(error: unknown): error is { name: "StepError"; originalError: unknown }`
  - `interface Engine { define(name: string, version: string | undefined, fn: (ctx: { input: { commandId: string }; step: EngineStep }) => Promise<unknown>): void; dispatch(name: string, commandId: string): Promise<void>; defineSchedule(name: string, fn: (ctx: { step: EngineStep }) => Promise<unknown>, options: { cron: string; timezone?: string; runOnStart?: boolean }): void; start(options: { concurrency: number }): Promise<void>; stop(): Promise<void> }`
  - `function openWorkflowEngine(ow: OpenWorkflow): Engine` — `dispatch` faz a cadeia de `worker/nucleo/disparar.ts` (chave `commandId`; se `failed`, `` `${commandId}:retry:${runId}` ``); `defineSchedule` grava `scheduleWorkflow` no `start` (spec sem `version`) e, com `runOnStart`, um `runWorkflow` sem chave; `stop` para o worker (espera os runs em andamento)
  - `type Jsonify<T>` (Date → string, arrays e objetos recursivos, `undefined` → omitido, funções → never)
  - `interface Step { run<F extends (...args: any[]) => any>(name: string | { name: string; retryPolicy?: RetryPolicy }, fn: F, ...args: Parameters<F>): Promise<Jsonify<Awaited<ReturnType<F>>>> }`
  - `function createStep(engineStep: EngineStep, defaultPolicy?: RetryPolicy): Step` — `defaultPolicy` é mesclado sob a política de cada chamada. Dentro da função do step, captura `CommandFailure` (definida na Task 11; por ora, qualquer erro com `name === "CommandFailure"`), devolve um marcador `{ __icFail: message }` e, já fora do step, lança `CommandFailure(message)` de novo. Assim, `fail()` dentro de um step nunca é repetido.

- [ ] **Step 1: Escrever os testes** (com `owTemporario`)

```ts
test("a step that fails once then succeeds completes (retries are not swallowed)", …/* retryPolicy { maximumAttempts: 3, initialInterval: "10ms" } */);
test("engineControlFlow: StepError before the last attempt → true; at the last → false; Stale/Sleep → true", …/* erros fabricados com name/stepFailedAttempts/retryPolicy */);
test("fail inside a step: thrown once, step not retried", …/* contador de chamadas === 1 */);
test("defaultPolicy applies when the call has none", …);
test("dispatch twice with the same id creates one run", …/* count workflow_runs where idempotency_key = id → 1 */);
test("dispatch after a failed run chains a retry key", …/* idempotency_key like 'id:retry:%' */);
test("step.run passes args and returns Date as ISO string", …/* typeof r.quando === "string" */);
test("schedule with runOnStart runs once at start", …);
test("stop waits for an in-flight run", …);
```
Tipos: `// @ts-expect-error` para argumento de tipo errado e para argumento faltando; `r.quando` é `string`.

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar.** Expected: tudo passa.
- [ ] **Step 5: Commit** — `feat(commands): motor interno sobre o OpenWorkflow e step.run tipado`

---

### Task 11: Handler, `fail`, `failCommand`, `complete` e escritas de status

**Files:**
- Create: `src/worker/status.ts`, `src/worker/handler.ts`, `src/worker/index.ts` (exporta `fail`, `failCommand`, tipos)
- Test: `src/worker/handler.test.ts`, `testes/integracao/status.test.ts`, `testes/tipos/handler.ts`

**Interfaces:**
- Consumes: `Command`, `ResultInputOf`, `validateResult`, `CommandResultError`, `Step`
- Produces:
  - `class CommandFailure extends Error {}`; `function fail(message: string): never`
  - `function failCommand<C extends Command>(command: C, id: string, message: string): TransactionChunk<any, any>` (usa `tx` de `@instantdb/admin`; grava `status: "failed"`, `error`, `finishedAt`)
  - `type CommandRecord<C extends Command> = { id: CommandId<C> } & FieldValues<C>` e `type CommandHandle<C> = CommandRecord<C> & { complete(result?: ResultInputOf<C>): TransactionChunk<any, any> }` (`complete` valida com `validateResult` e lança `CommandResultError`; grava `status: "done"`, `result`, `finishedAt`, `error: null`)
  - `type HandlerContext<C extends Command, S extends InstantSchemaDef<any, any, any> = InstantUnknownSchema> = { db: InstantAdminDatabase<S>; command: CommandHandle<C>; step: Step }`
  - `type Handler<C, S> = { command: C; fn: (ctx: HandlerContext<C, S>) => Promise<ResultInputOf<C> | void>; options: HandlerOptions }`, `type HandlerOptions = { version?: string; retryPolicy?: RetryPolicy; defaultErrorMessage?: string }`
  - `function defineHandler<C extends Command, S>(command: C, fn: Handler<C, S>["fn"], options?: HandlerOptions): Handler<C, S>`
  - Em `status.ts`, todas sem fantasma (consultam o id antes; se não existir, não escrevem e devolvem `false`): `markRunning(db, command, id): Promise<"started" | "resumed" | "absent" | "finished">`, `markFailed(db, command, id, message): Promise<boolean>`, `markDone(db, command, id, result): Promise<boolean>`

- [ ] **Step 1: Escrever os testes**

```ts
test("fail throws CommandFailure", …);
test("complete validates the result and builds a done chunk", …);
test("complete with an invalid result throws CommandResultError", …);
// integração
test("markRunning: pending → running and attempts+1 → 'started'", …);
test("markRunning: running → attempts+1 → 'resumed'", …);
test("markRunning: done/failed → 'finished', no write", …);
test("markFailed on a deleted command writes nothing (no ghost)", async () => {
  /* cria, apaga, markFailed → false; db.query pelo id → [] */
});
test("markDone on a deleted command writes nothing", …);
```
Tipos (`testes/tipos/handler.ts`): `if (!g) fail("x"); g.id` compila; com `import * as ic`, `ic.fail` também; `// @ts-expect-error` em `command.complete({ pares: "3" })` para `sortear`.

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar.** Expected: tudo passa.
- [ ] **Step 5: Commit** — `feat(commands): handler, fail/failCommand e escritas de status sem fantasma`

---

### Task 12: Execução de um command (checagem → handler → finalização)

**Files:**
- Create: `src/worker/execution.ts`
- Test: `testes/integracao/execucao.test.ts`

**Interfaces:**
- Consumes: `Engine`, `createStep`, `markRunning`/`markFailed`/`markDone`, `validateInput`, `Handler`, `CommandFailure`
- Produces:
  - `type RunnerEvent` (união com `type` em: `webhook.ensured`, `webhook.received`, `webhook.rejected`, `sweep`, `subscribed`, `resubscribed`, `delivery`, `run.started`, `run.done`, `run.failed`, `run.skipped`, `run.invalid_input`, `subscription.error`; campos só `{ type, command?: string, commandId?: string, count?: number, error?: string, fields?: string[] }`; `fields` só em `run.invalid_input`, com os nomes dos campos, nunca os valores)
  - `function registerHandler(engine: Engine, db: InstantAdminDatabase<any>, handler: Handler<any, any>, emit: (e: RunnerEvent) => void): void` — define o workflow `handler.command.name`/`options.version`. O `step` entregue ao handler usa `options.retryPolicy` como política padrão (sobreposta pela de cada `step.run`); `defaultErrorMessage` padrão das Global Constraints. Corpo:
    1. step `ic:check`: `markRunning`; `absent`/`finished` → `run.skipped` e fim;
    2. `validateInput(..., "worker")` no registro relido; problemas → `markFailed(defaultErrorMessage)` + `run.invalid_input` (só nomes dos campos) e fim;
    3. chama o handler dentro de `try`, com `createStep(engineStep, options.retryPolicy)`;
    4. no `catch`, **primeiro** `if (engineControlFlow(e)) throw e` — sem isso, a primeira falha de um step encerraria o command e nenhuma retentativa aconteceria;
    5. `CommandFailure` → step `ic:fail` com `markFailed(mensagem)` + `run.failed`;
    6. falha final de step (`isFinalStepFailure`) ou outra exceção do handler → step `ic:fail` com `markFailed(defaultErrorMessage)` + `run.failed` com `error` = mensagem do erro original;
    7. retorno normal → step `ic:finish`: se ainda `running`, `markDone(valor validado)`; resultado inválido segue o item 6; `run.done`.
    - `CommandResultError` lançado por `command.complete()` **dentro** de um step chega como `StepError` e seria repetido: `complete()` deve ser chamado para montar a transação, e a validação é síncrona; documentar no README que o resultado inválido só termina após as tentativas do step, ou validar com `validateResult` antes do step quando o handler quiser falhar logo.

- [ ] **Step 1: Escrever os testes** (OpenWorkflow temporário + app de teste + handler de `sortear` de teste)

```ts
test("happy path: handler completes in its own transaction → done with result", …);
test("handler returns a value without complete → done with that result", …);
test("fail('msg') → failed with error 'msg', no retry", …);
test("step that fails once then succeeds → done (retry not swallowed)", …/* retryPolicy { maximumAttempts: 3, initialInterval: "10ms" } */);
test("step that exhausts retries → failed with defaultErrorMessage; event carries the real error", …/* retryPolicy { maximumAttempts: 2, initialInterval: "10ms" } */);
test("fail('msg') inside a step → failed with 'msg', handler runs once", …);
test("command deleted mid-run → no ghost recreated", …/* handler espera um sinal; teste apaga o grupo (cascade); libera */);
test("already done command → run.skipped, handler not called", …);
test("stored input with wrong type → failed + run.invalid_input with field names", …);
test("invalid returned result → failed with defaultErrorMessage", …);
```
Para o teste de entrada inválida: o Instant valida tipos na escrita depois do push do schema, então `rodada: "x"` pode ser recusado. Conferir primeiro; se for recusado, simular o "formato antigo" com um campo obrigatório ausente (gravado com `adminICSemSchema()` numa entidade de teste com campo `.optional()` só no schema empurrado, mas obrigatório na ficha), e manter os casos de tipo cobertos pelos testes unitários de `validateInput`.

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar.** Expected: tudo passa.
- [ ] **Step 5: Commit** — `feat(commands): execução de command com checagem e finalização`

---

### Task 13: Disparo e varredura

**Files:**
- Create: `src/worker/dispatch.ts`
- Test: `testes/integracao/disparo.test.ts`

**Interfaces:**
- Consumes: `Engine.dispatch`, `RunnerEvent`
- Produces:
  - `function sweep(db: InstantAdminDatabase<any>, engine: Engine, commands: readonly Command[], emit): Promise<number>` — consulta pontual `{ [entity]: { $: { where: { status: { $in: ["pending", "running"] } } } } }` de cada entidade, `engine.dispatch` para cada id, emite `sweep` com `count`; erro de um dispatch não interrompe os demais (emite `run.failed` sem campos do command)
  - `function startPeriodicSweep(run: () => Promise<number>, everyMs: number): { stop(): void }` (sem sobreposição: se uma varredura ainda roda, pula o tick)

- [ ] **Step 1: Escrever os testes**

```ts
test("sweep dispatches the prefix's pending and running ids, not its done/failed ones", …/* engine falso que grava ids; afirmar sobre os 4 ids criados pelo teste, nunca sobre totais: o app é compartilhado */);
test("the same command notified 3 times (sweep x3) runs the handler once", …);
test("periodic sweep does not overlap", …/* run lento + everyMs 10 */);
```

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar.** Expected: tudo passa.
- [ ] **Step 5: Commit** — `feat(commands): varredura de commands pendentes`

---

### Task 14: Aviso por assinatura (`subscription`)

**Files:**
- Create: `src/worker/subscription.ts` (extraído de `worker/nucleo/campainha.ts`, traduzido para inglês, mesmo comportamento)
- Test: `src/worker/subscription.test.ts` (portar os casos de `worker/nucleo/campainha.test.ts`), `testes/integracao/assinatura.test.ts`

**Interfaces:**
- Produces: `function startSubscription(options: { name: string; subscribe: Subscription<{ id: string }>; onItems(ids: string[]): Promise<void>; backoffMs?: number[]; emit }): { stop(): void }` e `function instantSubscription(db, query): Subscription<{ id: string }>`; `startSubscriptionTrigger(db, engine, commands, { resubscribeEveryMs }, emit): { stop(): void }` que junta as duas e reassina tudo a cada `resubscribeEveryMs`.

- [ ] **Step 1: Portar os testes da campainha** (entrega, erro → reassina com backoff, backoff zera na entrega, callback de assinatura obsoleta ignorado, `stop`) e adicionar: `"resubscribes every resubscribeEveryMs"`; integração `"a pending command created after start is dispatched"`.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar.** Expected: tudo passa.
- [ ] **Step 5: Commit** — `feat(commands): aviso por assinatura com reassinatura periódica`

---

### Task 15: Aviso por webhook (rota, `ensureWebhook`, servidor embutido)

**Files:**
- Create: `src/worker/webhook.ts`, `src/worker/server.ts`
- Test: `src/worker/webhook.test.ts` (com `db.webhooks` falso), `testes/integracao/webhook-manager.test.ts`

**Interfaces:**
- Consumes: `Engine.dispatch`, `RunnerEvent`, a decisão de `docs/spikes/hairpin-webhook.md`
- Produces:
  - `function createWebhookHandler(options: { db; engine; commands: readonly Command[]; maxBodyBytes: number; emit }): (req: Request) => Promise<Response>`:
    1. `content-length` acima de `maxBodyBytes` → `413`;
    2. `db.webhooks.validateRequest(req)` lança → `401` + `webhook.rejected`;
    3. `fetchPayloads` (falha → `503`); só registros `action === "create"` cujo `namespace` é entidade de um command (ou a `action` registrada no Task 1 para `update` em id novo, se diferente);
    4. `engine.dispatch` de cada → `200` + `webhook.received` com `count`;
    5. erro no dispatch → `503`;
    - nunca `410`
    - corpo sem `content-length` (chunked): ler com limite e responder `413` ao passar de `maxBodyBytes`
  - `function ensureWebhook(db, publicUrl: string, entities: string[], emit): Promise<string>` (`manager.list()`, procura `sink.url === publicUrl`; cria com `{ url, namespaces, actions: ["create"] }`, ou `update` se `namespaces`/`actions` diferem (comparar como conjuntos), ou `enable` se `status === "disabled"`; devolve o id; emite `webhook.ensured`)
  - `function startServer(options: { port: number; path: string; healthPath: string; maxBodyBytes: number; handler: (req: Request) => Promise<Response> }): { port: number; stop(): Promise<void> }` (`Bun.serve` com `routes`: `POST path`, `GET healthPath` → `ok`; `fetch` → `404`; `maxRequestBodySize: maxBodyBytes`)

- [ ] **Step 1: Escrever os testes**

```ts
test("invalid signature → 401, no dispatch", …);
test("create of a command entity → dispatch + 200", …);
test("update/delete or unknown namespace → 200 without dispatch", …);
test("dispatch error → 503, never 410", …);
test("body over maxBodyBytes → 413 before validation", …);
test("ensureWebhook creates when missing", …/* manager falso */);
test("ensureWebhook updates namespaces when a command is added", …);
test("ensureWebhook re-enables a disabled webhook", …);
test("ensureWebhook is a no-op when everything matches", …);
test("server: GET /health → ok, unknown path → 404", …/* porta 0 */);
// integração contra o manager real do app de teste, com a URL pública do Task 1 (decisão a/b) ou pulada na decisão c
test("ensureWebhook round-trip on the real manager", …/* URL única por execução (`https://<host do Task 1>/ic/hook?run=<prefixo>`); cria, confere, apaga no afterAll; no beforeAll, apaga webhooks do app cuja sink.url tenha `?run=t` com mais de 1 hora */);
test("fetchPayloads failure → 503", …);
test("chunked body over maxBodyBytes → 413", …);
```

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar.** Expected: tudo passa.
- [ ] **Step 5: Commit** — `feat(commands): aviso por webhook com ensureWebhook e servidor embutido`

---

### Task 16: `createRunner`, `initCommands` e `defineSchedule`

**Files:**
- Create: `src/worker/runner.ts`, `src/worker/init.ts`, `src/worker/schedule.ts`
- Modify: `src/worker/index.ts`
- Test: `src/worker/runner.test.ts`, `testes/integracao/runner.test.ts`, `testes/tipos/runner.ts`

**Interfaces:**
- Consumes: tudo de Tasks 10–15
- Produces:
  - `type Trigger = { type: "webhook"; publicUrl: string; server?: "builtin" | "external"; port?: number; healthPath?: string; sweepEveryMs?: number; maxBodyBytes?: number } | { type: "subscription"; resubscribeEveryMs?: number }`
  - `type RunnerOptions<S, Hs extends readonly Handler<any, S>[]> = { ow: OpenWorkflow; db: InstantAdminDatabase<S>; handlers: Hs & UniqueHandlers<Hs>; schedules?: readonly Schedule<S>[]; concurrency?: number; trigger: Trigger; onEvent?: (e: RunnerEvent) => void }` — `createRunner` é genérico em `const Hs`, para que um handler repetido seja erro de tipo (`UniqueHandlers` com a mesma técnica de frase de `UniqueCommands`)
  - `type Runner = { start(): Promise<void>; stop(): Promise<void>; webhookHandler: (req: Request) => Promise<Response> }` (`webhookHandler` existe nos dois modos de servidor; no modo `subscription`, responde `404`)
  - `function initCommands<S extends InstantSchemaDef<any, any, any>>(): { defineHandler: <C extends Command>(command: C, fn: (ctx: HandlerContext<C, S>) => Promise<ResultInputOf<C> | void>, options?: HandlerOptions) => Handler<C, S>; createRunner: <const Hs extends readonly Handler<any, S>[]>(options: RunnerOptions<S, Hs>) => Runner }`
  - Padrão do app, documentado no README e coberto por teste de tipo, para declarar o handler como função nomeada separada: `type Ctx<C extends Command> = ic.HandlerContext<C, AppSchema>` no `worker/commands.ts` do app. `HandlerContext<C>` sem o segundo parâmetro tem `db` com schema desconhecido e **não** serve para isso.
  - `type ScheduleContext<S> = { db: InstantAdminDatabase<S>; step: Step }`, `function defineSchedule<S>(options: { name: string; cron: string; timezone?: string; runOnStart?: boolean; run: (ctx: ScheduleContext<S>) => Promise<unknown> }): Schedule<S>`
  - Checagens de `createRunner` (lança `CommandDefinitionError`, e o mesmo como erro de tipo): handler repetido para a mesma ficha; fichas com `entity` ou `name` repetidos; schedule com `name` de uma ficha.
  - `start()` na ordem da spec (Runner, passos 1–2): registra workflows e schedules → `engine.start({ concurrency: options.concurrency ?? 2 })` → aviso (webhook: `ensureWebhook`, servidor se `builtin`, varredura ao subir, varredura periódica; subscription: assinatura). `stop()` na ordem inversa.

- [ ] **Step 1: Escrever os testes**

```ts
test("rejects duplicate handler / entity / name / schedule name", …toThrow(CommandDefinitionError));
test("webhook mode: start ensures the webhook, starts the server and sweeps once", …/* db.webhooks falso, porta 0 */);
test("webhook mode external: no server, webhookHandler works", …);
test("defaults: port from PORT, path from publicUrl, /health, 5 min sweep", …);
// integração, modo subscription contra o app de teste
test("end to end: sendCommand as organizer → handler runs → waitForCommand sees done with typed result", …);
test("stop waits for the in-flight run and stops sweeping", …);
test("schedule runOnStart runs once with db typed", …);
```
Tipos: com `initCommands<TestSchema>()`, `ctx.db.query({ grupos: {} })` é tipado; um handler declarado como `async function executar(ctx: Ctx<typeof sortear>)` (com o alias `Ctx` do app) é aceito por `defineHandler`; `// @ts-expect-error` em `createRunner({ handlers: [h1, h1], … })`.

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar a suíte inteira** (`bun run test` no pacote). Expected: tudo passa.
- [ ] **Step 5: Commit** — `feat(commands): createRunner, initCommands e defineSchedule`

---

### Task 17: E2E do modo webhook na VPS

Só com a decisão (a) ou (b) do Task 1. Na decisão (c), registrar "e2e de webhook não aplicável" em `docs/spikes/hairpin-webhook.md` e pular.

**Files:**
- Create: `testes/e2e/worker.ts` (runner em modo webhook com `initCommands<TestSchema>()`, handler de `sortear` que conclui com `{ pares: 0 }`, `publicUrl` de `WEBHOOK_URL`, OpenWorkflow em `/data/ow.db`), `testes/e2e/Dockerfile` (no molde de `worker/Dockerfile`, instalando só o workspace `pacotes/instant-commands`)
- Create: `testes/e2e/e2e.test.ts` (roda da máquina local; fica fora do `bun run test` porque o script só passa `src testes/integracao`; rodar com `IC_E2E=1 bun --env-file=../../.env test testes/e2e`, e os testes usam `test.skipIf(!process.env.IC_E2E)` como segunda trava)

**Interfaces:**
- Consumes: `createRunner`, `sendCommand`, `waitForCommand`, `testes/app/commands.ts`

- [ ] **Step 1: Subir o app descartável `ic-teste-worker`** como no Task 1 (domínio `ic-teste-worker.app.tpou.gy`, Let's Encrypt, `WEBHOOK_URL=https://ic-teste-worker.app.tpou.gy/ic/hook`, `IC_TEST_*`, volume para o `ow.db`, regra de nginx do Task 1 na decisão (a)).

- [ ] **Step 2: Escrever o e2e**

```ts
test("webhook: a command reaches done in under 10 s", …);
test("worker down: command waits; after restart the startup sweep finishes it in under 30 s", …/* ssh dokku ps:stop / ps:start */);
test("direct POST from the internet is refused", …/* decisão (a): 403; decisão (b): 401 */);
```

- [ ] **Step 3: Rodar.** Expected: os três passam.
- [ ] **Step 4: Destruir `ic-teste-worker` e o webhook dele**, e anotar o resultado em `docs/spikes/hairpin-webhook.md`.
- [ ] **Step 5: Commit** — `test(commands): e2e do modo webhook na VPS`

---

### Task 18: Documentação

**Files:**
- Create: `pacotes/instant-commands/README.md` (inglês: o que é, os seis pontos de entrada, exemplo completo da ficha ao cliente com `import * as ic`, os dois modos de aviso, a seção de implantação com a regra "never enable `INSTANT_WEBHOOK_ALLOW_INSECURE`", "one project = one worker = one domain = one webhook", e os limites conhecidos: sem compare-and-set, `fail` não pode ser desestruturado, schemas de `result` síncronos)
- Create: `docs/propostas/plataforma-workflows-webhook.md` (texto proposto para `~/pessoal/vps/docs/plataforma-workflows.md`: o padrão de webhook por projeto com o IP e o trecho de nginx do Task 1; não aplicar no repo da VPS)
- Modify: `docs/ideias/instant-openworkflow.md` (status: virou `instant-commands`, link para a spec e o pacote)
- Modify: `docs/superpowers/specs/2026-11-25-instant-commands-design.md` (status: implementado; registrar os desvios do plano:
  - o alias `Ctx<C> = HandlerContext<C, AppSchema>` no app;
  - o tratamento de erros de controle do OpenWorkflow (Task 10/12);
  - `fail()` dentro de step não é repetido;
  - `.create` vs `.update` no `sendCommand`, conforme o Task 1;
  - a limitação conhecida: o espalhamento de `commandEntities`/`commandLinks` sobrescreve em silêncio uma entidade ou link do app com o mesmo nome. A garantia vem de `mergePerms`, que acusa a entidade duplicada quando ela tem regras, e da documentação.)

- [ ] **Step 1: Conferir os exemplos do README compilando.** Copiar o exemplo para `testes/tipos/readme.ts` e rodar `tsc --noEmit -p .`. Expected: sem erros.
- [ ] **Step 2: Escrever os documentos.**
- [ ] **Step 3: Rodar `bun run test` na raiz.** Expected: todas as suítes passam.
- [ ] **Step 4: Commit** — `docs(commands): README, proposta para a VPS e status da spec`

---

## Pendências após a execução (2026-11-25)

Itens menores que as revisões adiaram. Nada aqui bloqueia o uso. O que a rodada final já resolveu ficou de fora: content-length no webhook, TypeScript 5.9.3, `mergePerms` com base anotada e entre commands, varredura isolada por entidade, `json` obrigatório com `null` e README.

- **Limite de steps × falha do Instant:** se o `markFailed` lançar no caminho do `StepLimitExceededError`, o erro original some e o `dispatch` volta a encadear retry. É raro, porque exige o Instant fora do ar no mesmo instante em que se chega a 1000 steps. Correção: `try/catch` em volta do `markFailed` e relançar sempre o erro original.
- **`null` de `json` vira `undefined`:** o `ic:check` transforma o `null` de um campo `json` obrigatório em `undefined` antes de entregar ao handler.
- **Eventos inconsistentes:**
  - `run.failed` e `run.invalid_input` saem mesmo quando o `markFailed` não grava;
  - `ic:finish` emite `run.done` para qualquer status diferente de `failed`.
- **Cliente:** `waitForCommand` espera o timeout em vez de rejeitar logo quando a assinatura recebe um payload de erro; falta teste unitário do status `failed`.
- **Tipos:**
  - `Jsonify<never>` vira `null`;
  - chave obrigatória com valor `undefined` não vira opcional;
  - falta teste de tipo para `name` repetido;
  - `Prettify` está duplicado;
  - o teste do parâmetro `const` usa uma ficha que já é literal.
- **Validação:** `validateResult` usa `instanceof Promise` em vez de checar thenable; `allow` ausente em JS puro dá `TypeError`; `allow.link` fica fora da checagem de `data.ref`.
- **Testes a completar:**
  - replay do marcador `__icFail`;
  - callback de geração obsoleta na assinatura;
  - rollback do `start()`;
  - os testes que leem `__ops` dependem da forma interna do Instant;
  - o nome do teste "wrong type" (ele cobre campo ausente).
- **Runner:**
  - `start()` que falhou não pode ser repetido no mesmo processo (documentado);
  - `PORT` não numérico;
  - a guarda de `start` do motor não protege chamadas concorrentes;
  - nomes de step `ic:*` são reservados só na documentação.
- **Código duplicado:** `isCommandFailure` aparece em `step.ts` e em `execution.ts`.
- **Teste instável:** `client > core SDK path` deu timeout uma vez numa execução intermediária.
- **Regras de link em entidades de sistema:** opção em `mergePerms` para não gerar as regras reversas `link`/`unlink: "true"` em entidades como `$users` (hoje o usuário consegue desvincular o próprio pedido pendente com uma transação forjada). Opcional: `errorName` em `run.failed`, para o `erroClasse` dos logs deixar de ser quase sempre `desconhecido`.
