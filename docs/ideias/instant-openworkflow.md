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

## Pontos difíceis

- Entrega "pelo menos uma vez" sem efeitos duplicados: os passos precisam aguentar repetir, e a biblioteca só pode ajudar com convenções e com `request.complete` na mesma transação.
- Reconexão das assinaturas depois de quedas. A janela diária das 04:30 da VPS é um bom teste.
- Compatibilidade com o Instant original e com o instantdb-rust. Por ser paridade, deve funcionar igual, mas os detalhes da resposta podem variar entre versões: por exemplo, um link vazio volta `null` no `fb241e1a` e ausente no `de47af8`.
- Tipos: inferir a entrada do pedido a partir das entidades e links gerados, sem perder a tipagem do schema do app.

## Estimativa

Baixa a média: TypeScript puro sobre APIs públicas e estáveis (SDK admin, webhooks, OpenWorkflow). Uma primeira versão com testes levaria uma a duas semanas, extraindo `nucleo/campainha.ts` e `nucleo/disparar.ts` do amigo-secreto. Caminho realista de divulgação: pacote próprio no npm e um exemplo ou link na documentação do instantdb-rust (`examples/`), não uma funcionalidade no servidor.
