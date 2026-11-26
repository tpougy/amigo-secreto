# Migrar o amigo-secreto para o `instant-commands`: plano revisado

**Data:** 2026-11-25 · **Status:** implementado na branch `feat/migracao-instant-commands`; corte em produção pendente (roteiro em `docs/runbooks/corte-instant-commands.md`). Texto abaixo: plano revisado depois do gancho `onFailure` (na `main` até `6a0c6f0`). Depois da consulta de produção (nada a converter), o próximo passo é o design da migração completa, em corte único.

## Onde estamos

- A biblioteca `instant-commands` está na `main`, em `pacotes/instant-commands`, agora com `onFailure` (spec: `docs/superpowers/specs/2026-11-25-instant-commands-onfailure-design.md`). O amigo-secreto **ainda não usa nada dela**: o worker continua com a campainha própria (`worker/nucleo/campainha.ts`, `disparar.ts`).
- Para ler antes de começar: o README da biblioteca (seção "How a command ends"), a spec principal (`docs/superpowers/specs/2026-11-25-instant-commands-design.md`, com os desvios no fim), as pendências no fim de `docs/superpowers/plans/2026-11-25-instant-commands.md` e, para o modo webhook, `docs/spikes/hairpin-webhook.md`.

## Os três pedidos que existem hoje

| Pedido | Entidade | Campos de entrada | Status hoje | Erro | Link | Reserva algo ao ser criado? |
|---|---|---|---|---|---|---|
| Sortear | `sorteios` | `rodada`, `chave` (única) | `pendente → processando → concluido \| erro` | `erro` | `grupo` (cascade) | **sim**: a `chave` `<grupoId>:<rodada>` |
| Reabrir grupo | `reaberturas` | — | `pendente → concluido \| erro` | `erro` | `grupo` (cascade) | não |
| Apagar conta | `pedidosExclusao` | — | `pendente → concluido` | não tem | `usuario` → `$users` (sem cascade) | não |

## A mudança de comportamento que atravessa tudo

Hoje, uma falha inesperada (passo que esgota as tentativas) deixa o pedido `pendente`, e a campainha abre outro run: o worker **insiste para sempre**. Com a biblioteca, a falha termina em `failed` com `defaultErrorMessage`, e **ninguém tenta de novo**. O `onFailure` resolve a parte do estado preso; a parte de "quem tenta de novo" fica com cada pedido:

| Pedido | Quem vê a falha | Precisa de `onFailure`? | Quem tenta de novo |
|---|---|---|---|
| Sortear | o organizador, na tela | **sim**: renomear a `chave` | o organizador, clicando de novo (a chave liberada permite) |
| Reabrir | o organizador, na tela | não | o organizador, clicando de novo |
| Apagar conta | **ninguém**: a tela sai da sessão logo depois de criar o pedido | não | **ninguém** — ver "Exclusão de conta" abaixo |

Em todos: passar `defaultErrorMessage` em português no `defineHandler` (o padrão da biblioteca é inglês) e manter a política longa de hoje nos passos (`retryPolicy` = `RETRY_PASSO_PADRAO`, 300 tentativas, ~5 h), para que `failed` só aconteça depois de horas de Instant fora do ar ou de um bug.

## Decisões tomadas

1. **Nomes: adotar os da biblioteca (opção a).** Configurar a biblioteca (b) deixaria genéricos complexos para sempre por um único consumidor; começar só com pedidos novos (c) manteria dois sistemas.

   | Hoje | Biblioteca |
   |---|---|
   | `pendente` / `processando` / `concluido` / `erro` | `pending` / `running` / `done` / `failed` |
   | `erro` (campo) | `error` |
   | `criadoEm` / `concluidoEm` | `createdAt` / `finishedAt` |
   | — | `attempts`, `result` |

   **Não há dados a converter.** Consulta de produção em 2026-11-25: 4 grupos, todos `aberto`, nenhum sorteado; `sorteios`, `reaberturas` e `pedidosExclusao` vazios (o `e2e-producao` limpa o que cria). O histórico de runs do OpenWorkflow (`/data/ow.db`) pode ser abandonado: os nomes de workflow novos o ignoram e o `limparHistorico` o apaga em 30 dias. O `ow.db` em si fica, porque guarda os agendamentos. Os atributos antigos saem no mesmo push de schema. Os baldes de rate limit mudam de nome (`sorteio` → `sorteios`), e os contadores zeram.

2. **`processando` vira `running`.** O `ic:check` grava `running` antes do handler, e todas as regras e telas usam `pendente || processando` no sentido de "aberto" = `pending || running`. O passo `marcar-processando` sai; a fase fina continua no stream. Sem campo `fase`.

3. **Modo `subscription` primeiro.** O webhook vem depois dos três pedidos migrados.

4. **Um corte só, para os três pedidos.** Sem dados a converter, migrar um pedido por vez só traria custo: a convivência dos dois mundos no worker e estados intermediários nas regras cruzadas. O desenvolvimento segue a ordem reabertura → exclusão de conta → sorteio numa branch, e a produção recebe tudo num deploy. `campainha.ts` e `disparar.ts` saem de uma vez.

## Como cada pedido fica

### Reabertura

- `defineCommand({ name: "reabertura", entity: "reaberturas", fields: {}, links: { grupo, cascade }, bind/allow das regras atuais, rateLimit })`.
- Handler: os passos atuais (`carregar`, `reabrir`), trocando as escritas de status por `command.complete({ pares })` na transação do `reabrir` e `ic.fail(MSG_…)` nos erros de negócio. As irmãs pendentes continuam com `failCommand` na mesma transação.
- **Armadilha:** `motivoErro` e o filtro de `irmas` passam a olhar `pending || running`, e não só `pendente`. E a regra `sorteios.semReaberturaPendente` também: hoje a reabertura vai direto de `pendente` para `concluido`; na biblioteca ela passa por `running`, e uma regra que olhe só `pending` liberaria um sorteio durante a reabertura.

### Exclusão de conta

- `defineCommand({ name: "exclusao-conta", entity: "pedidosExclusao", links: { usuario → $users, sem onDelete }, allow: { create/view: dono, delete: "false" } })`.
- Handler: `limpar-dados` → `apagar-usuario`, cada um num passo, e retorna. A biblioteca grava `done` depois (o pedido sobrevive ao usuário porque não há cascade). A ordem atual fica preservada.
- **Ponto novo, e o mais sério da revisão:** a pessoa sai da sessão assim que o pedido é registrado e nunca vê o status. Se o run terminar em `failed`, ela acha que a conta foi apagada e não foi. Isso é dado pessoal que deveria ter sido apagado. O `onFailure` não ajuda aqui, porque não há reserva a liberar. Proposta:
  - um `defineSchedule` diário, `reprocessar-exclusoes`, que procura pedidos `failed` cujo `$users` ainda existe e cria um pedido novo como admin, ligado ao mesmo usuário (o handler é idempotente: `limparDados` lê o estado atual);
  - e um log de alerta no `onEvent` para `run.failed` de `exclusao-conta`, para alguém olhar se repetir.
- **A verificar no app de teste:** `mergePerms` gera `link`/`unlink: "true"` no lado reverso, em `$users`. O servidor já recusa regra de `delete` em `$users`; não sei se aceita de link.

### Sorteio

- `defineCommand({ name: "sorteio", entity: "sorteios", fields: { rodada: i.number(), chave: i.string().unique() }, ... })`, com as regras atuais (`rodadaValida`, `chaveCerta`, `grupoNaoEncerrado`, `semReaberturaPendente` = sem reabertura `pending || running`).
- Handler: `carregar` → `sortear` → `gravar-pares`. `gravar-pares` continua relendo o estado e grava pares, grupo e `command.complete({ pares })` numa transação só.
- **Erros de negócio** (rodada inválida, participantes mudaram, grupo encerrado, `ErroSorteio`): só `ic.fail(MSG_…)`. `marcarErro` some.
- **A `chave`:** `onFailure: liberarChave`, cobrindo também as falhas inesperadas:
  ```ts
  function liberarChave({ db, command }: FailureContext<typeof sorteio, AppSchema>) {
    if (typeof command.chave !== "string") return [];
    return [db.tx.sorteios[command.id].update({ chave: `${command.chave}:erro:${command.id}` })];
  }
  ```
  O formato é o mesmo de hoje, então os sorteios antigos em `erro` já convertidos continuam coerentes.
- **Stream:** as fases `embaralhando`, `sorteando` e `pronto` continuam dentro dos passos (`escreverFase(db, streamDoSorteio(command.id), …)`). A fase `erro` vai para o `onEvent` (`run.failed` com `command === "sorteio"`), em melhor esforço; a tela já usa o `status` quando o stream não fecha. Filtrar os eventos extras que começam com `onFailure`, para não fechar o stream duas vezes.
- **Grupo apagado durante o sorteio:** a cascata apaga o sorteio; a biblioteca não grava nada num command apagado e não chama o gancho. Mesma proteção contra fantasmas que `estadoAtual` dá hoje.
- Regras de outras entidades que mudam junto: `participantes.semSorteioEmAndamento` e `reaberturas.semSorteioEmAndamento` passam a olhar `pending || running`. Sugestão: um utilitário em `perms.ts`, `emAberto(ref)`, para não espalhar o texto CEL.

## O worker depois do corte

Fatos verificados no código, que continuam valendo mesmo sem convivência:

- A deduplicação do OpenWorkflow é por `(workflow_name, idempotency_key)`, **sem a versão**. Os commands usam nomes de workflow novos (`reabertura`, `exclusao-conta`, `sorteio`), nunca `reabrir-grupo` etc. com outra versão.
- `runner.start()` cria o worker do OpenWorkflow sobre todos os workflows registrados no `ow`. Os workflows agendados que continuam (`limparHistorico`, `estatisticas`) são registrados no mesmo `ow` **antes** de `runner.start()`, e o `ow.newWorker` do `main.ts` sai.

## O corte

1. Backup do Postgres (runbook da VPS).
2. Parar o worker e confirmar que `sorteios`, `reaberturas` e `pedidosExclusao` continuam vazios. Se aparecer algum registro (um sorteio real no "Amigo Livro Permutações", por exemplo), convertê-lo na mão antes de seguir.
3. Push do schema e das regras, com `pacotes/instant/testes/permissoes.*` atualizados e passando no app de teste antes.
4. Deploy do worker, do app e do MCP.
5. Subir o worker e rodar `scripts/e2e-producao.ts` (atualizado para `sendCommand`).

Rollback: reimplantar código, schema e regras antigas. Os pedidos criados depois do corte se perdem nesse caso, aceitável enquanto não houver uso real.

## Riscos

- **Usuários reais:** janela curta, backup antes, rollback testado.
- **Regras cruzadas:** um CEL errado pode liberar um sorteio durante uma reabertura. Os testes de permissão cobrem os dois sentidos antes do push.
- **Testes de `pacotes/instant` dependem de dados globais do app de teste** (`permissoes.conta.test.ts` quebra com restos de execuções interrompidas).
- **Pendências da biblioteca** ainda abertas no plano original: o caso raro no limite de 1000 steps com o Instant fora do ar, e `waitForCommand` só rejeitando no timeout quando a assinatura falha. E a residual do `onFailure`: extras que causem erro não-4xx de forma determinística fazem o handler rodar de novo (no sorteio, a única escrita extra é a renomeação da própria chave, então o risco é baixo).
- **TypeScript 6.0.3 com `@instantdb/core` 1.0.67:** valores de atributo saem como `any` no app e no worker.

## Próximo passo

Design da migração completa (os três pedidos, corte único, modo `subscription`), com o reprocessamento das exclusões falhas aprovado.
