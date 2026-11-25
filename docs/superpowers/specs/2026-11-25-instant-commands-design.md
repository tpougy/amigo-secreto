# `instant-commands`: API de commands duráveis sobre o Instant (design)

**Data:** 2026-11-25 · **Status:** implementado em `pacotes/instant-commands` (ver "Status da implementação e desvios", no fim); API aprovada (Thomaz). Origem: [`docs/ideias/instant-openworkflow.md`](../../ideias/instant-openworkflow.md), que traz a motivação e a pesquisa de projetos parecidos.

## Intenção

O Instant não tem funções de servidor e não deixa enfileirar trabalho dentro de uma transação. O amigo-secreto contorna isso com um padrão próprio:
1. o cliente grava um registro `pendente` (um sorteio, uma reabertura, um pedido de exclusão);
2. um worker assina os pendentes e roda um workflow durável no OpenWorkflow;
3. o worker grava o resultado no próprio registro, e o cliente acompanha pelo Instant em tempo real.

Hoje cada pedido exige mexer em quatro lugares: entidade no `schema.ts`, regras no `perms.ts`, workflow e campainha no worker. A biblioteca empacota o padrão: um **command** é declarado num arquivo só, e a biblioteca gera schema, regras, assinatura, disparo e acompanhamento.

O público é quem continuar no Instant em hospedagem própria depois do fim do Instant Cloud (31/08/2027). O plano de divulgação é modesto: pacote no npm e um exemplo no instantdb-rust.

## Objetivos

- Declarar um command num arquivo, só com a nomenclatura do Instant (`forward`/`reverse`, `bind`/`allow`, formato de `$rateLimits`).
- Separar a declaração, que o navegador pode importar, da implementação, que só o worker importa.
- Garantir que o cliente só cria commands `pending` e que só o worker, como admin, muda o status.
- Executar cada command uma vez em condições normais e aguentar repetições quando algo falha.
- Concluir o command na mesma transação da escrita de negócio.
- Escrever handlers com funções nomeadas, sem arrows anônimas obrigatórias.

## Fora do escopo

- Funcionalidade no servidor do Instant ou do instantdb-rust.
- Outros bancos além do Instant.
- Vários motores de workflow na v1: só o OpenWorkflow, atrás de uma interface interna estreita (ver Restrições).
- Migrar o amigo-secreto para a biblioteca. Ver "Adoção no amigo-secreto", no fim.
- Interface visual de acompanhamento dos runs.

## Anti-objetivos (falha mesmo que funcione)

- Código do worker (consultas admin, segredos) chegar ao pacote do navegador.
- A biblioteca recriar como "fantasma" um command apagado, com um `update` num id que não existe mais.
- Mensagens de exceção chegarem ao usuário: o campo `error` é visível a quem tem `view` e só pode conter mensagens escolhidas pelo app.
- A API exigir vocabulário novo para coisas que o Instant já nomeia.

## Restrições

- Usa só APIs públicas: SDK admin do Instant (`query`, `transact`, `subscribeQuery`, `webhooks`) e OpenWorkflow.
- Nunca depende de `INSTANT_WEBHOOK_ALLOW_INSECURE` (ver Implantação do modo webhook).
- Deve funcionar igual no Instant original e no instantdb-rust. Diferenças conhecidas entre versões, como link vazio voltando `null` ou ausente, são tratadas pela biblioteca.
- O Instant não tem escrita condicional (compare-and-set). Dois runs do mesmo command podem, em casos raros, rodar ao mesmo tempo. A biblioteca reduz a janela, mas os handlers precisam aguentar repetição.
- A `idempotencyKey` do OpenWorkflow dura 24 h, então não é a garantia principal. A garantia é a checagem de status antes do run (ver Runner).
- O OpenWorkflow fica atrás de uma interface interna com o mínimo necessário: rodar com chave, `step.run` com política de retry, agendamento por cron. Não é para expor agora uma abstração pública de motor; é só para não fechar a porta a DBOS ou Absurd.

## Abordagens consideradas

**Onde ficam a entidade e o link do command:**
- **A ficha declara tudo (escolhida).** `defineCommand` recebe `fields` e `links`. O `schema.ts` espalha `commandEntities(commands)` e `commandLinks(commands)`.
  - Prós: mantém "um command, um arquivo"; renomear um link é uma mudança num lugar só.
  - Contra: o `schema.ts` deixa de mostrar o banco inteiro.
- O schema declara, com `requestEntity(...)` e links escritos à mão, e a ficha só tem as regras.
  - Prós: o `schema.ts` continua mostrando tudo; adoção mais fácil num app existente.
  - Contras: o command fica dividido em dois arquivos, e `mergePerms` precisaria ler o schema.

**Declaração e implementação:**
- **Separadas (escolhida):** `defineCommand` no pacote compartilhado e `defineHandler` no worker. Segue o modelo do Convex, do DBOS e do próprio worker atual (`defineWorkflowSpec` separado de `ow.defineWorkflow`).
- Um objeto só com `run`: tudo num lugar, mas exige que o empacotador remova o código de servidor. É frágil e o vazamento passa despercebido.

**Nomenclatura:**
- **`command` + `handler` (escolhida):** o par do padrão CQRS. "Command" é a intenção de mudar o estado, que pode ser recusada.
- `request`: era a tradução de "pedido", mas colide com `request.modifiedFields` nas regras CEL e com o `Request` do HTTP.
- `job` e `task`: sugerem trabalho que o backend inicia e escondem que o cliente cria e acompanha.
- `action`: tem outro sentido no Convex e no Redux.

**Formato da ficha:**
- **Os objetos do Instant como estão (escolhida):** o link é o mesmo bloco do `schema.ts`, as regras usam `bind`/`allow` e o rate limit usa o formato de `$rateLimits`.
- Forma curta própria (`{ to, reverse, onDelete }`, `perUser: "5/hora"`): menos texto, mas é vocabulário a aprender.

**Como o runner fica sabendo dos commands:**
- **Webhook como padrão, assinatura como opção (escolhida).** O aviso do webhook é durável (gravado na transação do command) e toda falha é visível, sem a conexão "meio aberta" da assinatura. Com as varreduras ao subir e periódica, o pior atraso fica em ~5 min. Custa um endereço HTTPS por worker.
- Só assinatura, como hoje: zero configuração, mas pode parar de receber sem erro (até 10 min, até a reassinatura).
- Webhook para a rede interna com `INSTANT_WEBHOOK_ALLOW_INSECURE`: descartado. A chave é global e transforma o Instant numa ponte para a rede interna, a serviço de qualquer token vazado.

**Validação do resultado em execução:**
- **`result` aceita também um Standard Schema (escolhida).** O worker valida antes de gravar e o cliente valida ao ler, o que protege contra dados antigos. O custo é o validador ir para o pacote do navegador. Também é possível usar só `i.json<T>()`.
- Só `i.json<T>()`: tipo sem validação em execução e sem dependência no navegador, mas sem proteção contra dados de um formato anterior.

## Vocabulário

| Termo | O que é |
|---|---|
| **command** | a declaração: entidade, campos, links, regras e rate limit |
| **handler** | a implementação de um command no worker |
| **step** | um passo durável dentro do handler, com resultado salvo e não repetido depois de concluído |
| **run** | uma execução de um handler para um command específico (do OpenWorkflow) |
| **schedule** | trabalho por horário, sem command |
| **runner** | o processo que assina os commands pendentes e dispara os runs |

## Pacote

Nome: `instant-commands`. Por ora, mora neste repositório como workspace (`pacotes/instant-commands`), aproveitando o Bun e os testes de integração contra o instantdb-rust local. O primeiro plano termina num pacote testado, sem publicar. Repositório próprio, npm e o exemplo no instantdb-rust ficam para depois, se a ideia se provar. Enquanto a migração do amigo-secreto não for decidida, o worker continua com a própria campainha, e o código fica duplicado por um tempo.

Pontos de entrada:

| Import | Conteúdo | Pode ir ao navegador? |
|---|---|---|
| `instant-commands` | `defineCommand`, tipos | sim |
| `instant-commands/schema` | `commandEntities`, `commandLinks` | sim |
| `instant-commands/perms` | `mergePerms` | sim |
| `instant-commands/client` | `sendCommand`, `subscribeCommand`, `waitForCommand` | sim |
| `instant-commands/worker` | `initCommands` (que devolve `defineHandler` e `createRunner` tipados), `defineSchedule`, `fail`, `failCommand`, tipos | não |
| `instant-commands/serverless` (fora da v1) | `createWebhookRoute`, `sweepPending` | não |

Os pontos de entrada que podem ir ao navegador não importam nada de `worker` nem de `serverless`. O modo webhook do runner vive em `worker` e usa `db.webhooks` do `@instantdb/admin` (`validateRequest`, `fetchPayloads`, `manager`), sem dependência nova.

## A ficha: `defineCommand`

```ts
// pacotes/instant/commands/sortear.ts
import { i } from "@instantdb/core";
import { z } from "zod";
import { defineCommand } from "instant-commands";

export const sortear = defineCommand({
  name: "sortear",
  entity: "sorteios",
  fields: {
    rodada: i.number(),
    chave: i.string().unique(),
  },
  links: {
    sorteioGrupo: {
      forward: { on: "sorteios", has: "one", label: "grupo", onDelete: "cascade" },
      reverse: { on: "grupos", has: "many", label: "sorteios" },
    },
  },
  bind: {
    ehOrganizador: "auth.id in data.ref('grupo.organizador.id')",
    ehMembro: "auth.id in data.ref('grupo.participantes.usuario.id')",
  },
  allow: {
    create: "ehOrganizador && data.rodada > 0",
    view: "ehOrganizador || ehMembro",
    delete: "ehOrganizador",                                       // exigido pelo cascade
    link: { grupo: "auth.id in linkedData.ref('organizador.id')" },
  },
  rateLimit: { limits: [{ capacity: 5, refill: { amount: 5, period: "1 hour", type: "greedy" } }] },
  result: z.object({ pares: z.number().int() }),   // ou i.json<{ pares: number }>(), só tipo
});
```

| Campo | Obrigatório | Significado |
|---|---|---|
| `name` | sim | nome do workflow no OpenWorkflow e nos logs; estável mesmo se a entidade mudar de nome |
| `entity` | sim | entidade do Instant onde ficam os commands; também é a chave do rate limit |
| `fields` | não (padrão `{}`) | valores de entrada, com os construtores do Instant (`i.number()`...); viram campos da entidade |
| `links` | não (padrão `{}`) | entradas que apontam para coisas existentes, no formato de link do Instant |
| `bind` | não | apelidos CEL, como no `perms.ts` |
| `allow.create` | sim | quem pode criar o command |
| `allow.view` | sim | quem pode ver o command e acompanhar o status |
| `allow.delete` | não (padrão `"false"`); **obrigatório se algum link tiver `onDelete: "cascade"`** | quem pode apagar. O servidor do Instant confere `delete` também nos filhos apagados em cascata (avaliado no estado anterior, com o pai ainda ligado). Com `"false"`, o dono do pai não conseguiria apagá-lo. É o caso de `reaberturas.delete: "ehOrganizador"` no `perms.ts` atual. |
| `allow.link` | não | por link (chave = `forward.label`), uma checagem extra sobre `linkedData` na criação. Ex.: `{ grupo: "auth.id in linkedData.ref('organizador.id')" }` |
| `rateLimit` | não | um bucket no formato de `$rateLimits`, aplicado por usuário |
| `result` | não (sem ele, o resultado é `null`) | o formato do resultado. Aceita duas formas: `i.json<T>()`, que só dá o tipo, ou um **Standard Schema** (zod, valibot, arktype...), que dá o tipo e a validação em execução (ver Validação em execução) |

Validações feitas ao definir, ao importar o módulo (erro com mensagem clara):
- todo link tem `forward.on === entity` e `forward.has === "one"`;
- `fields` não usa nomes reservados (ver Entidade gerada);
- `allow` não tem `update` (é sempre `"false"`) nem `unlink` (é sempre `"false"`);
- as chaves de `allow.link` são `forward.label` de links declarados;
- se algum link tem `onDelete: "cascade"`, `allow.delete` foi informado;
- todo identificador usado em `allow` que não é palavra do CEL do Instant (`auth`, `data`, `newData`, `linkedData`, `ruleParams`, `request`, `actions`, `rateLimit`...) está no `bind`;
- o primeiro segmento de cada `data.ref('…')` em `bind` e `allow` é um `forward.label` da ficha ou um campo (`fields` ou campo padrão). Pega um `data.ref('group.…')` digitado errado antes do deploy;
- essas duas últimas checagens são por padrão de texto, não uma análise completa do CEL.

`defineCommand` devolve um objeto de dados, sem efeito colateral.

**Regras que citam outras entidades:** as expressões de `bind` e `allow` são CEL livre. Exemplo: um sorteio é negado se houver reabertura pendente (`!('pending' in data.ref('grupo.reaberturas.status'))`). Fora as checagens acima, a biblioteca não interpreta essas expressões.

## Tipos

O objetivo é que o compilador pegue erros de uso sem anotações extras do app. Todas as técnicas abaixo foram conferidas num teste de tipos contra TypeScript 6.0.3 e `@instantdb/core` 1.0.67, exceto onde está marcado.

- **Parâmetro de tipo `const` em `defineCommand`** (a mesma técnica do `i.schema` do Instant): os labels e os nomes são inferidos como literais, sem `as const`.
- **A entrada vem dos `i.*`.** `InputOf<typeof cmd>` é montado a partir de `DataAttrDef<Valor, Obrigatório, …>` de cada campo, mais cada `forward.label` como `string`. Campo `.optional()` é opcional na entrada; o ideal é reaproveitar os utilitários do Instant (`ResolveAttrs` e afins) em vez de reinventar.
- **O resultado vem de `result`.**
  - `ResultOf<typeof cmd>` é o `T` de `i.json<T>()` ou o `InferOutput` do Standard Schema; é o que o cliente recebe.
  - `command.complete(...)` aceita o `InferInput`.
  - Sem `result`, é `null`.
- **`CommandId<typeof cmd>` com marca** (como o `Id<"tabela">` do Convex): é uma `string` em execução. Passar o id de um command para funções de outro é erro de compilação.
- **`step.run(nome, fn, ...args)`:** `args` são conferidos contra `Parameters<typeof fn>`, e o retorno é `Promise<Jsonify<Awaited<ReturnType<typeof fn>>>>` (como o `Jsonify` do Inngest).
  - Um `Date` devolvido por um step aparece como `string`, porque é assim que ele volta numa retomada lida do `ow.db`.
  - O `step.run` do OpenWorkflow devolve o tipo cru, e o embrulho corrige isso.
- **`fail` é uma função de módulo declarada `: never`.** Depois de `if (!x) fail("…")`, o compilador entende que `x` não é nulo. Isso **não** funciona se `fail` for desestruturado do contexto (`async function h({ fail })`). Por isso ele não é oferecido no contexto, e a documentação avisa.
- **`commandEntities` usa remapeamento de chaves** (`[C in Cs[number] as C["entity"]]`). O `InstaQLEntity<typeof schema, "sorteios">` do app enxerga `status` como `"pending" | "running" | "done" | "failed"` e os `fields` com seus tipos.
- **Conflitos são erro de compilação com frase legível.** Quando há conflito, o tipo do parâmetro vira uma mensagem: `'perms.ts já define a entidade "sorteios", que pertence a um command'`. Vale para `mergePerms` (entidade, rate limit, regra de link) e para entidades ou nomes repetidos numa lista de commands. Não usar o truque do parâmetro extra condicional, que gera "Expected 3 arguments, but got 2".
- **`initCommands<AppSchema>()`** (como o `initTRPC` e o `_generated/server` do Convex; não conferido no teste).
  - Amarra o schema do app uma vez no worker e devolve `defineHandler` e `createRunner` já tipados.
  - O `db` do `HandlerContext` é `InstantAdminDatabase<AppSchema>`.
  - A ficha não importa `AppSchema`: o `schema.ts` importa as fichas, e a inferência entraria em círculo.
- **`mergePerms` usa o `InstantRules<AppSchema>` do Instant** como tipo da base (o `perms.ts` já faz `satisfies InstantRules<AppSchema>`). Também aceita entidades de sistema fora do schema, como o `$streams` do `perms.ts:311`.

**Não fazer:**
- tipar o CEL no sistema de tipos com template literal types: deixa o editor lento e gera mensagens ilegíveis;
- geração de código, como o Convex faz;
- decorators;
- builders encadeados;
- aceitar outro validador para `fields`: os `i.*` viram o schema.

## Validação em execução

- **Entrada, no cliente:** `sendCommand` valida a entrada pelos `i.*` de cada campo (`valueType`, `required`, que existem em execução no `DataAttrDef`) e pela presença de cada link, antes de gravar. Em erro, lança `CommandInputError` listando os campos, sem chegar ao servidor.
- **Entrada, no worker:** o passo de checagem do runner valida de novo o command lido, porque pode ter sido gravado por um cliente antigo. Se inválido, o command vai para `failed` com `defaultErrorMessage`, e o `onEvent` recebe `run.invalid_input` com os nomes dos campos (sem os valores).
- **Resultado, no worker** (quando `result` é um Standard Schema): `command.complete(valor)` valida `valor` e grava o valor de saída. Se falhar, lança `CommandResultError` e o run segue o caminho de exceção inesperada. *(escolha minha)* Como `complete` devolve um pedaço de transação de forma síncrona, só schemas síncronos são aceitos: se a validação devolver uma `Promise`, é erro de definição com mensagem clara. Zod, valibot e arktype validam de forma síncrona nos casos comuns.
- **Resultado, no cliente:** `subscribeCommand` e `waitForCommand` validam o `result` lido, o que protege contra dados gravados antes de o formato mudar. *(escolha minha)* Se a validação falhar, o estado chega com `result: null` e `resultIssues` com os problemas, em vez de lançar erro no meio da assinatura.
- **Custo aceito:** o validador escolhido em `result` vai para o pacote do navegador junto com a ficha. Com `i.json<T>()`, não há validação em execução nem dependência extra.
- A biblioteca depende só do tipo `@standard-schema/spec`, não de zod.

## Entidade gerada

`commandEntities(commands)` gera, para cada command, `entity: i.entity({ ...camposPadrão, ...fields })`. Os campos padrão são:

| Campo | Tipo | Quem grava |
|---|---|---|
| `status` | `i.string().indexed()`: `"pending" \| "running" \| "done" \| "failed"` | cliente (`pending` ao criar), worker (o resto) |
| `error` | `i.string().optional()` | worker; só mensagens passadas a `fail` ou `failCommand`, ou a mensagem genérica |
| `result` | `i.json<ResultOf<cmd>>().optional()` | worker (`command.complete(result)`) |
| `attempts` | `i.number()` | cliente (`0` ao criar), worker (soma 1 a cada run iniciado) |
| `createdAt` | `i.date()` | cliente |
| `finishedAt` | `i.date().optional()` | worker, ao ir para `done` ou `failed` |

`commandLinks(commands)` devolve os `links` de cada ficha como estão.

Se o app já tiver no seu `schema.ts` uma entidade ou um link com o mesmo nome, isso é erro: a biblioteca não junta definições.

## Regras geradas: `mergePerms(basePerms, commands)`

Devolve o `basePerms` com o seguinte acrescentado, para cada command:

```ts
[entity]: {
  bind: ficha.bind,
  allow: {
    create: "rateLimit.<entity>.limit(auth.id) && (<allow.create>) && data.status == 'pending' && data.attempts == 0",
    view: "<allow.view>",
    update: "false",
    delete: "<allow.delete ?? 'false'>",
    link:   { [forward.label]: "actions.data == 'create' && (<allow.link[label] ?? 'true'>)" },  // por link
    unlink: { [forward.label]: "false" },                                                         // por link
  },
},
$rateLimits: { [entity]: ficha.rateLimit },   // só se a ficha tiver rateLimit
```

- O rate limit vem **primeiro** no `create`, para que até tentativas negadas gastem um token (como o `perms.ts` atual).
- Sem `rateLimit` na ficha, o trecho `rateLimit...` não entra.
- **Lado do command** (`forward.on`): o link só é feito na criação (`actions.data == 'create'`, mais a checagem opcional de `allow.link`) e nunca desfeito pelo cliente (`unlink: "false"`). É o que o `perms.ts` atual faz em `reaberturas` e `pedidosExclusao`. Sem isso, um cliente poderia desligar um command pendente do grupo e burlar regras como "não sortear com reabertura pendente".
- **Lado reverso** (`reverse.on`): entram `allow.link[reverse.label] = "true"` e `allow.unlink[reverse.label] = "true"`. Quem trava é o lado do command, como no `perms.ts` atual (`grupos.allow.link.reaberturas: "true"`).
- Se o `basePerms` já definir a entidade do command, a chave do rate limit ou a regra `link`/`unlink` gerada, isso é erro.
- `createdAt` não é validado nas regras (igual ao `criadoEm` atual).

## Implementação: `defineHandler`

```ts
// worker/commands.ts: amarra o schema do app uma vez
import { initCommands } from "instant-commands/worker";
import type { AppSchema } from "@amigo/instant";

export const { defineHandler, createRunner } = initCommands<AppSchema>();
export type { HandlerContext } from "instant-commands/worker";
```

```ts
// worker/handlers/reabrirGrupo.ts
import { fail, failCommand } from "instant-commands/worker";   // fail importado, nunca desestruturado
import { reabrirGrupo } from "@amigo/instant/commands";
import { defineHandler, type HandlerContext } from "../commands";

type Ctx = HandlerContext<typeof reabrirGrupo>;

async function carregarGrupo(db: Ctx["db"], commandId: string) { /* db.query */ }

function montarTransacao(db: Ctx["db"], command: Ctx["command"], grupo: Grupo) {
  const partes = [];
  for (const sorteio of grupo.sorteios) {
    for (const par of sorteio.pares) partes.push(db.tx.pares[par.id].delete());
  }
  partes.push(db.tx.grupos[grupo.id].update({ status: "aberto", rodadaBase: grupo.rodadaAtual }));
  for (const irma of grupo.reaberturas) {
    if (irma.id !== command.id && irma.status === "pending") {
      partes.push(failCommand(reabrirGrupo, irma.id, "O grupo não está sorteado"));
    }
  }
  partes.push(command.complete({ pares: contarPares(grupo) }));
  return partes;
}

async function aplicarReabertura(db: Ctx["db"], command: Ctx["command"], grupo: Grupo) {
  await db.transact(montarTransacao(db, command, grupo));
}

async function executarReabertura({ db, command, step }: Ctx) {
  const grupo = await step.run("carregar", carregarGrupo, db, command.id);
  if (!grupo) fail("O grupo não existe mais");
  if (grupo.status !== "sorteado") fail("O grupo não está sorteado");
  await step.run("reabrir", aplicarReabertura, db, command, grupo);
}

export const reabrirGrupoHandler = defineHandler(reabrirGrupo, executarReabertura, { version: "1" });
```

**`defineHandler(command, fn, options)`**
- `options.version`: versão do workflow no OpenWorkflow. Muda quando os steps mudam de forma incompatível.
- `options.retryPolicy`: política padrão dos steps.
- `options.defaultErrorMessage`: a mensagem do `error` quando o run falha por exceção inesperada (padrão: `"Não foi possível concluir"`, configurável). *(escolha minha: o padrão pode ficar em inglês no pacote, e o app passa o texto no idioma dele.)*

**Contexto (`HandlerContext<typeof command>`)**
- `db`: o admin do Instant que foi passado ao runner, tipado como `InstantAdminDatabase<AppSchema>` (via `initCommands`).
- `command`: `{ id: CommandId<cmd>, ...fields, complete(result?) }`. Os campos já foram validados pelo runner. Os links não vêm carregados: o handler consulta o que precisar.
  - `command.complete(result?)` valida `result` (se a ficha tiver um Standard Schema) e devolve um pedaço de transação que grava `status: "done"`, `result` e `finishedAt`, para pôr no mesmo `db.transact` da escrita de negócio.
- `step`: os passos duráveis.

**`step.run(nome, fn, ...args)`**
- Chama `fn(...args)` como um passo durável, e os tipos de `args` são conferidos contra os parâmetros de `fn`.
- Também aceita `step.run({ name, retryPolicy }, fn, ...args)`.
- O retorno precisa ser serializável em JSON (é guardado pelo OpenWorkflow). O tipo do retorno já é o "como JSON" (`Jsonify`): um `Date` aparece como `string` (ver Tipos).

**Como o command termina**
- **`fail(mensagem)`** lança um erro especial. A biblioteca grava `status: "failed"`, `error: mensagem` e `finishedAt`, sem tentar de novo.
- **`failCommand(command, id, mensagem)`** devolve um pedaço de transação que marca *outro* command como `failed`. Serve para os irmãos pendentes, como no exemplo.
- **Exceção inesperada** (depois de esgotados os retries do step): `status: "failed"` com `defaultErrorMessage`. A mensagem e a pilha da exceção vão só para o `onEvent`, nunca para o banco.
- **O handler retornou sem chamar `command.complete`**: a biblioteca grava `done` sozinha, com o valor retornado como `result`, validado como em `complete`. O tipo do retorno do handler é conferido contra `ResultOf<cmd>`.
- **Resultado inválido** (`CommandResultError`): segue o caminho da exceção inesperada.
- **Limite de steps do OpenWorkflow** (1000 tentativas de step por run): falha definitiva. A biblioteca grava `failed` com `defaultErrorMessage` fora de qualquer step (nenhum step pode mais ser gravado), emite `run.failed` com o erro real, e o disparo não encadeia `:retry:` para um run que falhou por esse limite (senão cada varredura reexecutaria todos os steps).
- **Command apagado durante o run:** a biblioteca confere a existência antes de cada escrita de status e, se ele não existe mais, não escreve nada. O handler continua responsável pelas próprias escritas. O `command.complete()` dentro de um `transact` faz `update` num id apagado: o handler deve reler antes, como o `reabrir()` atual faz. A biblioteca não consegue evitar isso sozinha sem escrita condicional.

## Runner: `createRunner`

```ts
// worker/main.ts
import { createRunner } from "./commands";

function registrarEvento(evento: RunnerEvent) { log(evento.type, evento); }

const runner = createRunner({
  ow, db,
  handlers: [sortearHandler, reabrirGrupoHandler, apagarContaHandler],
  schedules: [estatisticas],
  concurrency: 2,
  trigger: {                                   // padrão: webhook
    type: "webhook",
    publicUrl: process.env.WEBHOOK_URL!,       // https://amigo-worker.app.tpou.gy/ic/hook
    port: Number(process.env.PORT),
    sweepEveryMs: 5 * 60 * 1000,
  },
  onEvent: registrarEvento,
});
await runner.start();
process.on("SIGTERM", pararWorker);   // pararWorker chama runner.stop()
```

**Modos de aviso (`trigger`).** Os dois modos só mudam *como o runner fica sabendo* que há commands pendentes. Checagem, disparo e handlers são os mesmos.

| | `webhook` (padrão) | `subscription` |
|---|---|---|
| Aviso | o Instant faz um POST assinado para o worker a cada command criado | o worker assina a consulta de pendentes pelo WebSocket |
| Durabilidade do aviso | o evento é gravado na mesma transação do command (instantdb-rust) e reenviado pelo calendário do Instant (11 tentativas em ~2 dias e 18 h) | a assinatura reentrega o estado inteiro a cada mudança e ao reassinar |
| Falha silenciosa | não existe: cada aviso é um POST novo e toda falha vira erro HTTP com nova tentativa | conexão "meio aberta" pode parar de entregar sem erro; coberta pela reassinatura periódica |
| Rede de segurança | varredura ao subir + varredura periódica (`sweepEveryMs`, padrão 5 min) | reassinatura periódica (`resubscribeEveryMs`, padrão 10 min) |
| Exige | endereço HTTPS público para o worker (ver Implantação do modo webhook) | nada além do token de admin |
| Uso | produção na VPS | desenvolvimento local, testes, ou onde não houver endereço público |

```ts
trigger: { type: "subscription", resubscribeEveryMs: 10 * 60 * 1000 }
```

`createRunner` confere, antes de qualquer coisa (erro com mensagem clara):
- não há dois handlers para a mesma ficha;
- não há duas fichas com a mesma `entity` ou o mesmo `name`;
- não há schedule com o mesmo `name` de uma ficha.

As mesmas repetições também são erro de compilação (ver Tipos).

O que `runner.start()` faz:
1. Registra um workflow no OpenWorkflow para cada handler (nome da ficha, `version` do handler) e cada schedule.
2. Liga o aviso:
   - **`webhook`:**
     1. `ensureWebhook`: lista os webhooks do app (`db.webhooks.manager.list()`) e procura o de `publicUrl`. Garante que ele está ativo, com `namespaces` = exatamente as entidades dos handlers registrados e `actions: ["create"]`; cria, atualiza ou reativa conforme o caso. Assim, um command novo não exige mexer no Instant, e um webhook desativado (por exemplo por um `410`) volta no próximo reinício.
     2. Sobe o servidor HTTP com duas rotas, `POST <path de publicUrl>` e `GET /health`.
     3. Faz a **varredura ao subir**: uma consulta pontual dos `pending`/`running` de cada entidade.
     4. Agenda a varredura periódica.
   - **`subscription`:** assina, para cada handler, `{ [entity]: { $: { where: { status: { $in: ["pending", "running"] } } } } }`. Cada entrega já traz o estado atual, então os pendentes acumulados durante uma queda são processados ao assinar.
3. Para cada command avisado (pelo webhook, pela varredura ou pela assinatura), dispara um run com `idempotencyKey = command.id`. Se o run com essa chave estiver `failed`, encadeia `<id>:retry:<idDoRunFalho>`, como o `dispararComRetomada` atual.
4. **Checagem antes do handler (primeiro step interno):** relê o command. Se não existe, ou o status não é `pending` nem `running`, o run termina sem escrever nada. Se é `pending`, grava `running` e `attempts + 1`; se já é `running` (retomada depois de uma queda), só `attempts + 1`. Depois valida os campos pelos `i.*` da ficha. Se inválidos, grava `failed` com `defaultErrorMessage` e emite `run.invalid_input`.
5. **Na rota do webhook** (`runner.webhookHandler`; ver Servidor do modo webhook), para cada POST:
   1. lê o corpo uma vez como texto, com o limite `maxBodyBytes` aplicado na leitura qualquer que seja o `content-length` (acima → `413`), e valida com `db.webhooks.validate(cabeçalho instant-signature, texto)` (assinatura Ed25519, chaves do JWKS, tolerância de horário do SDK). Inválido ou sem cabeçalho → `401`, sem mais nada;
   2. busca o conteúdo com `db.webhooks.fetchPayloads(body)`;
   3. considera só registros `create` de entidades com handler; os outros são ignorados com `200`;
   4. dispara cada um (passo 3) e responde `200`.
   - Erro ao disparar (OpenWorkflow fora) → `503`, e o Instant tenta de novo pelo calendário dele.
   - **Nunca responde `410`:** o Instant desativaria o webhook.
   - O tempo de resposta fica bem abaixo dos 20 s do Instant, porque a rota só enfileira.
   - O conteúdo do aviso é tratado como campainha: só o id é usado, e o command é relido no banco pela checagem do passo 4.
6. **Na assinatura** (modo `subscription`), em erro, reassina com backoff (1, 2, 5, 10 e 30 s), que zera na primeira entrega bem-sucedida. A cada `resubscribeEveryMs`, reassina tudo, para cobrir conexões meio abertas que nunca dão erro.
7. Emite eventos estruturados pelo `onEvent`: `webhook.ensured`, `webhook.received`, `webhook.rejected`, `sweep`, `subscribed`, `resubscribed`, `delivery`, `run.started`, `run.done`, `run.failed`, `run.skipped`, `run.invalid_input`, `subscription.error`. Os eventos nunca carregam campos do command além do id.

`runner.stop()` para de aceitar POSTs (ou fecha as assinaturas), cancela a varredura periódica e para o worker do OpenWorkflow, esperando os runs em andamento.

A base é extrair `worker/nucleo/campainha.ts` (modo `subscription`) e `worker/nucleo/disparar.ts`, que já têm testes.

### Servidor do modo webhook

A rota do webhook é da biblioteca: o app não escreve servidor nem rota. O servidor é o `Bun.serve` embutido, com `routes`, sem dependência de framework. Ele entrega `Request`/`Response` padrão, que é o que `db.webhooks.validateRequest(req)` espera.

**Opções de `trigger` no modo webhook e seus padrões** (só `publicUrl` é obrigatório):

| Opção | Padrão | Por quê |
|---|---|---|
| `publicUrl` | obrigatório | o endereço cadastrado no Instant |
| caminho da rota | o caminho de `publicUrl` | uma fonte só: a rota servida é sempre a cadastrada |
| `server` | `"builtin"` | ver abaixo |
| `port` | `process.env.PORT`, ou `3000` | o Dokku injeta `PORT` |
| `healthPath` | `/health` | o checks do Dokku no deploy sem interrupção |
| `sweepEveryMs` | 5 min | a varredura periódica |
| `maxBodyBytes` | 64 KB | o aviso do Instant só traz `{ payloadUrl, token }` |

**Convenção de caminho:** `/ic/hook`, por exemplo `https://amigo-worker.app.tpou.gy/ic/hook`. `ic` é o apelido do pacote (ver Convenção de import).

**`server: "builtin" | "external"`**
- **`"builtin"` (padrão):** `runner.start()` sobe um `Bun.serve` com `POST <caminho>` e `GET <healthPath>`; qualquer outra rota responde `404`. `runner.stop()` chama `server.stop()`, que para de aceitar conexões e espera as em andamento.
- **`"external"`:** o runner não sobe servidor. Ele cadastra o webhook e liga as varreduras, e expõe `runner.webhookHandler: (req: Request) => Promise<Response>` para o app montar no servidor que já tem (Bun, Hono, Next, Cloudflare). O tamanho máximo do corpo e o `/health` passam a ser do app.

```ts
// modo external: a rota pendurada no servidor do próprio app
await runner.start();
Bun.serve({
  routes: {
    "/ic/hook": { POST: runner.webhookHandler },
    "/api/outra-coisa": { GET: outraRota },
  },
});
```

`runner.webhookHandler` é a mesma função nos dois modos (o `"builtin"` só a monta). É ela que a variante serverless reaproveitaria.

**Detalhes da rota:**
- o corpo é lido **só** por `validateRequest`: um `Request` só pode ser lido uma vez, e a verificação precisa dos bytes exatos;
- corpo acima de `maxBodyBytes` → `413`, antes de qualquer verificação.

### Convenção de import

A documentação e os exemplos usam o apelido `ic`, com import de namespace, para que o uso deixe claro o que vem da biblioteca:

```ts
// pacotes/instant/commands/sortear.ts
import * as ic from "instant-commands";
export const sortear = ic.defineCommand({ ... });

// worker/handlers/sortear.ts
import * as ic from "instant-commands/worker";
async function executarSorteio({ db, command, step }: HandlerContext<typeof sortear>) {
  const grupo = await step.run("carregar", carregarGrupo, db, command.id);
  if (!grupo) ic.fail("O grupo não existe mais");   // estreita o tipo de `grupo`
  ...
}

// app (navegador)
import * as ic from "instant-commands/client";
const id = await ic.sendCommand(db, sortear, { ... });
```

- Cada arquivo importa um único ponto de entrada, então o mesmo apelido `ic` não colide.
- `ic.fail(...)` estreita o tipo depois do `if`, assim como o `fail` importado por nome (conferido com TypeScript 6.0.3). Só não funciona desestruturado do contexto.
- O apelido é convenção de documentação; importar por nome continua funcionando.

### Implantação do modo webhook

**Regra: nunca ligar `INSTANT_WEBHOOK_ALLOW_INSECURE` no servidor do Instant.** Ela é global para todos os apps do servidor: com ela, um token de admin vazado de qualquer projeto vira acesso à rede interna da VPS. O Instant faria POSTs para serviços internos, e os primeiros 256 caracteres da resposta ficariam gravados no histórico do evento, legível pelo mesmo token. O próprio instantdb-rust e o `CLAUDE.md` da VPS proíbem a chave em produção.

**Um projeto = um app no Instant = um worker = um domínio = um webhook.** Nada de roteador central de webhooks, pelo mesmo princípio de `plataforma-workflows.md` (nada de OpenWorkflow central).

| Projeto | Worker (Dokku) | `WEBHOOK_URL` |
|---|---|---|
| amigo-secreto | `amigo-worker` | `https://amigo-worker.app.tpou.gy/ic/hook` |
| outro projeto | `<projeto>-worker` | `https://<projeto>-worker.app.tpou.gy/ic/hook` |

- O domínio "bonito" de um projeto (ex.: `amigo.tpou.gy`, o front na Cloudflare) não muda nada. O endereço do worker só é chamado pelo Instant; o navegador nunca fala com o worker.
- **No Dokku, por projeto:** `ps:scale web=1 worker=0`, `proxy:enable`, `domains:set <projeto>-worker.app.tpou.gy`, `letsencrypt:enable`, `config:set WEBHOOK_URL=…`. Hoje o `amigo-worker` sobe com `proxy:disable` e `web=0 worker=1` (`infra/dokku/provisionar.sh`).
- **Nginx, por projeto:** `/home/dokku/<projeto>-worker/nginx.conf.d/so-a-vps.conf` com `allow <ip de origem do Instant>; deny all;`, no molde de `docs/decisoes/proxy-cloudflare.md` da VPS. A internet recebe `403`; o Instant, que sai da própria VPS, passa. A assinatura continua como segunda camada. O worker só tem `/ic/hook` e `/health`, então restringir o app inteiro não atrapalha.
- **Pré-requisito (primeira tarefa do plano): teste de hairpin na VPS.** É um teste para a VPS inteira, não por projeto:
  1. subir uma rota de eco num app `*.app.tpou.gy` com HTTPS;
  2. cadastrar um webhook de um app de teste para ela;
  3. confirmar que a entrega sai do container do Instant e chega pelo IP público da própria VPS;
  4. anotar o **IP de origem** visto pelo nginx, que vai na regra `allow`.
  - Se a entrega não chegar, o modo webhook não serve na VPS e o padrão volta a ser `subscription`.
  - Se chegar mas a origem não puder ser distinguida no nginx, fica sem a regra `allow`/`deny`, só com a assinatura.
- O resultado do teste e o trecho de nginx viram padrão documentado em `plataforma-workflows.md` da VPS. Esse repositório é do Thomaz: o texto é proposto, não aplicado.

## Schedules: `defineSchedule`

```ts
async function contarGrupos({ db }: ScheduleContext) { /* ... */ }

export const estatisticas = defineSchedule({
  name: "atualizar-estatisticas",
  cron: "0 * * * *",
  timezone: "America/Sao_Paulo",
  runOnStart: true,
  run: contarGrupos,
});
```

O `run` recebe `{ db, step }`. Repassa o agendamento do OpenWorkflow (workflow sem versão, como exige o agendamento atual).

## Cliente

```ts
import { sendCommand, subscribeCommand, waitForCommand } from "instant-commands/client";

function mostrarEstado(estado: CommandState<typeof sortear>) {
  // estado.status, estado.error, estado.result ({ pares: number } | null), estado.resultIssues;
  // estado é null se o command sumiu
}

async function aoClicarSortear(grupoId: string) {
  const id = await sendCommand(db, sortear, { grupo: grupoId, rodada: 2, chave: `${grupoId}:2` });
  const cancelar = subscribeCommand(db, sortear, id, mostrarEstado);
}
```

- **`sendCommand(db, command, entrada)`:** gera o id, faz `db.transact(db.tx[entity][id].update({ ...fields, status: "pending", attempts: 0, createdAt: Date.now() }).link({ ...links }))` e devolve o id como `CommandId<typeof command>`.
  - Antes de gravar, valida a entrada (ver Validação em execução); em erro, lança `CommandInputError`.
  - Se a regra negar, o erro do Instant é repassado.
  - `entrada` é tipada: os `fields` com seus tipos e cada `forward.label` como id (string).
- **`subscribeCommand(db, command, id, callback)`:** assina o command pelo id e chama `callback` a cada mudança. `id` precisa ser um `CommandId` do mesmo command. Valida o `result` lido (ver Validação em execução). Devolve a função que cancela.
- **`waitForCommand(db, command, id, { timeoutMs })`:** resolve com o estado final (`done` ou `failed`), ou rejeita no timeout. É para scripts e testes.
- Funciona com o `db` do `@instantdb/core` e com os pacotes que o envolvem (React, Svelte); usa só `transact` e `subscribeQuery`. Com React, o app também pode usar `db.useQuery` direto na entidade.

## Variante serverless, fora da v1

Diferente do modo `webhook` do runner, aqui não haveria processo de pé. A paridade de webhooks do instantdb-rust está confirmada (`docs/PARITY.md`: entrega, assinatura e retentativas iguais, com teste diferencial dedicado). Fica fora da v1 porque, com o OpenWorkflow, sempre é preciso um worker consultando a fila: a variante só enfileiraria runs, sem ser serverless de verdade. Volta junto com um motor que chama a função por HTTP (Workflow DevKit da Vercel, Inngest), atrás da interface interna de motor.

```ts
export const POST = createWebhookRoute({ ow, db, handlers: [sortearHandler, reabrirGrupoHandler] });
```

- Reaproveitaria a rota do modo `webhook` (passo 5 do runner) e a varredura como função avulsa (`sweepPending`), chamada por cron.

## Adoção no amigo-secreto (não decidida)

O amigo-secreto usa status e campos em português (`pendente`, `erro`, `criadoEm`, `concluidoEm`), e o sorteio tem um `processando` que não é retomada de queda. Adotar a biblioteca exigiria migrar os dados e as regras que citam esses valores (`perms.ts`, telas). Por isso esta especificação não inclui a migração. Se ela vier, será um design próprio.

## Fica com quem implementar

- A estrutura interna do pacote e a interface interna do motor.
- Os detalhes da implementação dos tipos descritos em Tipos. Recomenda-se testes de tipo (`@ts-expect-error` ou `expectTypeOf`) para cada garantia listada lá.
- Os testes, incluindo um de integração contra um Instant local (instantdb-rust), como os testes atuais do worker.
- O formato exato dos eventos do `onEvent`, além dos tipos listados.
- O tratamento das diferenças de resposta entre versões do Instant (link vazio `null` ou ausente).

## Status da implementação e desvios

Implementado como workspace `pacotes/instant-commands`, sem publicar. README em inglês no pacote; texto proposto para a VPS em `docs/propostas/plataforma-workflows-webhook.md`; resultados do hairpin e do e2e em `docs/spikes/hairpin-webhook.md`. O modo webhook foi validado na VPS (3 de 3 no e2e).

**Desvios em relação ao texto acima**

- **Alias `Ctx` no app:** `type Ctx<C> = HandlerContext<C, AppSchema>`. Um handler declarado como função separada precisa dele; `HandlerContext<C>` sem o schema tem um `db` de schema desconhecido.
- **Erros de controle do OpenWorkflow (Tasks 10 e 12):** são relançados, e só a falha final de um step encerra o command como `failed`.
- **`fail()` dentro de um step nunca é repetido:** o step termina com um marcador e o erro é relançado fora dele (nem retries, nem nova execução numa retomada).
- **`sendCommand` continua com `update`:** o Task 1 mostrou que um `update` num id novo chega ao webhook como `create`, então não foi preciso trocar por `.create`.
- **Command terminal nunca é sobrescrito:** `done` e `failed` não são reescritos pela biblioteca (nem por uma falha tardia do run).
- **`initCommands` também devolve um `defineSchedule` amarrado** ao schema, com checagem de nome em tempo de compilação.
- **`Runner.port`:** a porta do servidor embutido depois de `start()` (útil com `port: 0`).

**Limitações conhecidas**

- Espalhar `commandEntities`/`commandLinks` no `i.schema` sobrescreve em silêncio uma entidade ou um link do app com o mesmo nome. A garantia vem de `mergePerms`, que acusa a entidade duplicada quando ela tem regras, e da documentação. Link repetido, ou entidade sem regras, não é detectado.
- TypeScript 6.0.x com `@instantdb/core` 1.0.67 tipa os valores de atributos nos resultados de consulta como `any` (nomes e chaves das entidades continuam tipados). Com TypeScript 5.9, ficam totalmente tipados.
- Os demais limites (sem compare-and-set, `fail` não desestruturável, `result` com schema síncrono, `onEvent` sensível, `runner.start()` com falha não repetível na mesma instância) estão na seção "Known limitations and notes" do README.
