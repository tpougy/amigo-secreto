# Ideia: `instant-openworkflow`, uma biblioteca de pedidos duráveis para o Instant

**Data:** 2026-11-25 · **Status:** só ideia, sem compromisso de implementar. O amigo-secreto e o Pluto continuam com o arranjo atual (campainha + OpenWorkflow).

## Por que existe a lacuna

- O Instant (Cloud ou self-hosted, incluindo o instantdb-rust) **nunca teve funções de servidor**. A lógica de backend sempre foi do usuário: SDK admin, API HTTP admin e webhooks (POST assinado com Ed25519 quando uma entidade muda). As regras CEL só autorizam ou recusam.
- O instantdb-rust busca paridade exata com o servidor original. Até 2026-11-25 não havia sinal de funcionalidades novas nem de sistema de plugins (roadmap #15, pendências #38, `docs/PARITY.md`).
- No npm e no GitHub não havia biblioteca de jobs ou workflows para Instant.
  - O mais próximo é o `@ekairos/domain`. Ele organiza o schema em domínios e as escritas em ações tipadas, com execução durável pelo Workflow DevKit da Vercel (Next).
  - Ele não reage a mudanças no Instant: toda execução começa por uma chamada explícita (rota, CLI ou a plataforma Ekairos).
- O Instant Cloud encerra em 31/08/2027. Quem migrar para hospedagem própria vai precisar de um "backend de jobs", e cada projeto hoje resolve isso do seu jeito.

O amigo-secreto já é a prova de conceito do padrão: o cliente grava um pedido `pendente`, o worker reage, roda um workflow durável e grava o resultado, e o cliente acompanha em tempo real pelo `useQuery`.

## Ideia central: um "pedido" declarado num lugar só

Hoje, para a reabertura de grupo existir, mexemos em quatro lugares:
- a entidade `reaberturas` no `schema.ts`;
- as regras em `perms.ts`;
- o workflow em `worker/workflows/reabrirGrupo.ts`;
- a campainha (`processarReaberturas`) no `worker/main.ts`.

Com a biblioteca, um arquivo declara tudo:

```ts
// pedidos/reabrir.ts
import { defineRequest, fail } from "instant-openworkflow";

export const reabrir = defineRequest({
  entity: "reaberturas",                       // gera status, erro, resultado, criadoEm, terminadoEm
  workflow: { name: "reabrir-grupo", version: "1" },
  links: { grupo: { to: "grupos", reverse: "reaberturas", onDelete: "cascade" } },

  // Só a regra de negócio de quem pode pedir; o resto das regras é gerado
  bind: {
    ehOrganizador: "auth.id in data.ref('grupo.organizador.id')",
    ehMembro: "auth.id in data.ref('grupo.participantes.usuario.id')",
  },
  allow: {
    create: "ehOrganizador && 'sorteado' in data.ref('grupo.status')",
    view: "ehMembro || ehOrganizador",
  },
  rateLimit: { porUsuario: "10/hora" },

  async run({ request, db, step }) {
    const g = await step.run("carregar", () => carregarGrupo(db, request.id));
    if (!g) fail("O grupo não existe mais");           // → status "erro", erro = mensagem
    if (g.status !== "sorteado") fail("O grupo não está sorteado");

    return step.run("reabrir", () =>
      db.transact([
        ...g.pares.map((p) => db.tx.pares[p.id].delete()),
        db.tx.grupos[g.id].update({ status: "aberto", rodadaBase: g.rodadaAtual }),
        request.complete({ pares: g.pares.length }),   // conclui na MESMA transação
      ]),
    );
  },
});
```

`request.complete(...)` devolve um pedaço de transação que marca o pedido como `concluido` junto com a mudança de negócio. É o que `reabrir()` faz à mão hoje: se o processo cair no meio, nunca fica um grupo reaberto com o pedido ainda `pendente`.

## Schema e regras: a biblioteca gera, o app junta

```ts
// pacotes/instant/schema.ts
import { requestEntities, requestLinks } from "instant-openworkflow/schema";
import { sortear, reabrir, apagarConta } from "../pedidos";

const pedidos = [sortear, reabrir, apagarConta];

export default i.schema({
  entities: { grupos: i.entity({ ... }), ...requestEntities(pedidos) },
  links: { grupoOrganizador: { ... }, ...requestLinks(pedidos) },
});
```

```ts
// pacotes/instant/perms.ts
import { requestPerms } from "instant-openworkflow/perms";

export default {
  grupos: { ... },
  ...requestPerms(pedidos),
};
```

`requestPerms` gera para cada pedido:
- `create`: a regra do app, mais o rate limit, mais `status == 'pendente'`;
- `update: "false"`: só o worker, como admin, muda o status;
- `delete`: configurável, com padrão `false`;
- `view`: a regra do app.

## O worker inteiro

```ts
// worker/main.ts
import { OpenWorkflow } from "openworkflow";
import { BackendSqlite } from "openworkflow/sqlite";
import { createRunner, defineSchedule } from "instant-openworkflow";

const ow = new OpenWorkflow({ backend: BackendSqlite.connect("/data/ow.db") });

const estatisticas = defineSchedule({
  name: "atualizar-estatisticas",
  cron: "0 * * * *",
  timezone: "America/Sao_Paulo",
  runOnStart: true,
  run: ({ db }) => contarGrupos(db),
});

const runner = createRunner({
  ow,
  db,                                   // admin do Instant
  requests: [sortear, reabrir, apagarConta],
  schedules: [estatisticas],
  concurrency: 2,
  onEvent: (e) => log(e.type, e),       // logs estruturados (iniciado, concluido, erro, renovado)
});

await runner.start();
process.on("SIGTERM", () => runner.stop());
```

`runner.start()` faz o que hoje está espalhado entre `nucleo/campainha.ts`, `nucleo/disparar.ts` e o `main.ts`:
1. registra os workflows no OpenWorkflow;
2. **varre** os pedidos `pendente` que ficaram parados enquanto o worker estava fora do ar;
3. **assina** a consulta de pendentes de cada entidade (a campainha);
4. dispara cada pedido com chave de idempotência = id do pedido. Duas notificações do mesmo pedido viram um run só;
5. **renova** as assinaturas periodicamente, para cobrir conexões meio abertas (o watchdog de 10 minutos);
6. ignora pedidos apagados ou já terminados, sem fazer um `update` que recriaria um "fantasma".

## No cliente: só Instant, sem API nova

```ts
import { createRequest } from "instant-openworkflow/client";

const id = await createRequest(db, reabrir, { grupo: grupoId });

// O andamento chega pelo Instant, em tempo real
const q = db.useQuery({ reaberturas: { $: { where: { id } } } });
// q.data.reaberturas[0].status → "pendente" → "concluido" | "erro" (+ erro)
```

`createRequest` é só um `db.transact` tipado: preenche `status: "pendente"` e `criadoEm` e faz os links. Opcionalmente, `await waitForRequest(db, reabrir, id)` resolve quando o status chega ao fim, útil em scripts e testes.

## Variante sem processo próprio (webhook)

Para quem roda em serverless e não pode manter uma assinatura aberta:

```ts
import { createWebhookHandler } from "instant-openworkflow/webhook";

export const POST = createWebhookHandler({ ow, db, requests: [sortear, reabrir] });
// valida a assinatura do webhook do Instant e dispara o run do pedido criado
```

O webhook cobre o "avisar". A varredura de pendentes continua necessária, via cron, porque um webhook perdido não pode deixar um pedido parado para sempre.

## O que fica com quem

| A biblioteca garante | O app decide |
|---|---|
| campos de status e transições (`pendente → concluido/erro`) | o que o workflow faz |
| regras: só o admin muda o status, o cliente só cria `pendente` | quem pode pedir (`allow.create`/`view`) |
| uma execução por pedido (idempotência) | as mensagens de erro visíveis ao usuário |
| varredura ao subir e reassinatura periódica | o rate limit |
| conclusão atômica junto com a escrita de negócio | quando apagar pedidos antigos |
| agendamentos com a mesma interface | |

## Análogos em outras ferramentas (pesquisa de 2026-11-25)

Não há biblioteca equivalente para o Instant, mas o padrão existe há anos em outros lugares.

**O mesmo padrão "pedido como documento":**
- **Extensões do Firebase:** é o precedente mais forte.
  - No Trigger Email, o cliente cria um documento em `mail` e a extensão preenche `delivery.state` (`PENDING → PROCESSING → SUCCESS | ERROR`) com `error`, `attempts` e `leaseExpireTime`, o prazo depois do qual um `PROCESSING` travado conta como falha.
  - O cliente reenvia gravando `state: "RETRY"`.
  - No Run Payments with Stripe, o cliente grava em `checkout_sessions` e espera com `onSnapshot` até aparecer `url` ou `error`.
  - Cada extensão é uma funcionalidade fechada. Não existe um `defineRequest` genérico.
- **Hasura:**
  - As ações assíncronas devolvem um `action_id` e o cliente assina o resultado.
  - Os Event Triggers entregam "pelo menos uma vez", mas com 0 tentativas extras por padrão.
- **Jazz (Inbox API):** o cliente manda mensagens ao worker de servidor pela própria sincronização. Vem embutido, é experimental e exige o worker sempre no ar.

**Reagir a mudanças com execução durável:**
- **Inngest + Neon:** a replicação lógica do Postgres vira eventos, e os eventos disparam funções duráveis. Não tem convenção de status gravado de volta nem regras.
- **Supabase:**
  - os Database Webhooks (pg_net) não garantem a entrega;
  - o Queues (pgmq) usa um prazo de visibilidade, depois do qual a mensagem volta para a fila;
  - o Trigger.dev documenta o caminho webhook → Edge Function → task.
  - Isso confirma a seção de webhook acima: sem varredura, um aviso perdido deixa o pedido parado.
- **pgflow:** os fluxos são declarados em TypeScript e viram migrações SQL. É o mesmo espírito de `requestEntities(pedidos)`.
- **Graphile Worker:** o `add_job` pode rodar dentro de um trigger do Postgres, então o job entra na fila na mesma transação da escrita.

**O padrão ouro que o Instant não tem:**
- No **Convex**, `ctx.scheduler.runAfter` dentro de uma mutação é transacional: se a mutação confirma, o job está agendado; se falha, nada é agendado. O componente `@convex-dev/workflow`, com Workpool e o callback `onComplete`, cuida da parte durável.
- A campainha (assinatura, varredura e watchdog) só existe porque o Instant não deixa enfileirar trabalho dentro da transação.
- Na prática, a biblioteca implementa uma **outbox transacional** em que a própria entidade do pedido é a outbox.

**Motores duráveis que guardam o estado no banco** (alternativas ou referências ao OpenWorkflow):
- **DBOS:** o ID do workflow é a chave de idempotência, e essa chave **não expira**.
- **Absurd**, de Armin Ronacher: em produção desde 2025.
- **Workflow DevKit da Vercel:** tem um backend Postgres sobre graphile-worker, mas exige servidor persistente.

**Ecossistema do Instant:**
- O fim do Instant Cloud está confirmado: o time foi para a OpenAI em agosto de 2026, os apps param em 31/08/2027 e os backups ficam até 31/08/2028.
- Quem sair do Instant tende a ir para Convex, Pylon ou Supabase, que já têm funções de servidor.
- O público da biblioteca é só quem continuar no Instant em hospedagem própria. Daí o plano de pacote pequeno mais um exemplo, sem apostar em adoção grande.

## Ajustes que a comparação sugere

1. **Estados:**
   - incluir `processando` como opcional (os sorteios já usam: veja `perms.ts`);
   - incluir um campo `tentativas`;
   - talvez um "tentar de novo" pedido pelo cliente, como o `RETRY` do Firebase.
2. **Checar o status antes do `run`, feito pela biblioteca:**
   - A `idempotencyKey` do OpenWorkflow dura 24 h (veja `nucleo/disparar.ts`).
   - Um pedido que continue `pendente` depois disso, por worker fora do ar ou run travado, ganharia um run novo a cada entrega.
   - A garantia real é conferir que o pedido ainda está `pendente`, como `carregarReabertura` faz à mão. A biblioteca deve fazer isso antes de chamar `run`, sem deixar a cargo do app.
3. **`mergePerms(base, pedidos)` no lugar de `...requestPerms(pedidos)`:** um pedido também precisa:
   - das entradas em `$rateLimits`;
   - das regras de `link`/`unlink` na entidade-mãe (`grupos.allow.link.reaberturas`);
   - das regras que cruzam pedidos diferentes, como `semReaberturaPendente` no sorteio e o inverso na reabertura.
   - Só espalhar um objeto não cobre isso.
4. **OpenWorkflow atrás de uma interface interna estreita:** rodar com chave, `step.run` e agendamento. Não é para abstrair agora, só para não fechar a porta a DBOS ou Absurd.

## Pontos difíceis

- Sem escrita condicional no Instant (até onde sei, não há compare-and-set), dois runs concorrentes ainda podem ler `pendente` ao mesmo tempo. A checagem de status reduz a janela mas não a fecha. Os passos precisam aguentar repetir.
- Entrega "pelo menos uma vez" sem efeitos duplicados: os passos precisam aguentar repetir, e a biblioteca só pode ajudar com convenções e com `request.complete` na mesma transação.
- Reconexão das assinaturas depois de quedas. A janela diária das 04:30 da VPS é um bom teste.
- Compatibilidade com o Instant original e com o instantdb-rust. Por ser paridade, deve funcionar igual, mas os detalhes da resposta podem variar entre versões: por exemplo, um link vazio volta `null` no `fb241e1a` e ausente no `de47af8`.
- Tipos: inferir a entrada do pedido a partir das entidades e links gerados, sem perder a tipagem do schema do app.

## Estimativa

Baixa a média: TypeScript puro sobre APIs públicas e estáveis (SDK admin, webhooks, OpenWorkflow). Uma primeira versão com testes levaria uma a duas semanas, extraindo `nucleo/campainha.ts` e `nucleo/disparar.ts` do amigo-secreto. Caminho realista de divulgação: pacote próprio no npm e um exemplo ou link na documentação do instantdb-rust (`examples/`), não uma funcionalidade no servidor.
