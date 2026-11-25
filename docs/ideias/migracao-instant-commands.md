# Migrar o amigo-secreto para o `instant-commands`: considerações iniciais

**Data:** 2026-11-25 · **Status:** ponto de partida para um design, nada decidido.

## Onde estamos

- A biblioteca `instant-commands` está na `main` (merge de `feat/instant-commands`, até `86b1830`), em `pacotes/instant-commands`. O amigo-secreto **não usa nada dela ainda**: o worker continua com a campainha própria (`worker/nucleo/campainha.ts`, `disparar.ts`).
- Para ler antes de começar:
  - **A biblioteca:** `pacotes/instant-commands/README.md` (API, modos de aviso, limitações) e a especificação `docs/superpowers/specs/2026-11-25-instant-commands-design.md` (a seção final lista os desvios feitos na implementação).
  - **Pendências conhecidas:** o fim de `docs/superpowers/plans/2026-11-25-instant-commands.md`.
  - **Webhook na VPS:** `docs/spikes/hairpin-webhook.md` (regra de nginx, e2e) e `docs/propostas/plataforma-workflows-webhook.md`.
- A especificação deixou a migração fora de propósito ("Adoção no amigo-secreto (não decidida)"). Este documento levanta o que ela envolve.

## Os três pedidos que existem hoje

| Pedido | Entidade | Campos de entrada | Status hoje | Erro | Link | Onde aparece |
|---|---|---|---|---|---|---|
| Sortear | `sorteios` | `rodada`, `chave` (única) | `pendente → processando → concluido \| erro` | `erro` | `grupo` (cascade) | worker `sortear.ts`, app (`PainelSorteio`, `consultas.ts`, `regras.ts`), MCP (`ferramentas.ts`), regras de outras entidades |
| Reabrir grupo | `reaberturas` | — | `pendente → concluido \| erro` | `erro` | `grupo` (cascade) | worker `reabrirGrupo.ts`, app (`ConfiguracoesGrupo`), regras de `sorteios` |
| Apagar conta | `pedidosExclusao` | — | `pendente → concluido` | não tem | `usuario` → `$users` (sem cascade) | worker `apagarConta.ts`, app (`conta/+page.svelte`) |

Todos têm `criadoEm`; o sorteio também tem `concluidoEm`. Valores em português aparecem em 4 arquivos do app, 7 do worker, 5 de `pacotes/instant`, 3 do MCP e 1 de `scripts/`; `criadoEm` e `concluidoEm`, em cerca de 21 pontos fora dos testes.

## O que não bate com a biblioteca

1. **Nomes.** A biblioteca gera `status` (`pending`/`running`/`done`/`failed`), `error`, `result`, `attempts`, `createdAt`, `finishedAt`. O amigo-secreto usa `status` (`pendente`/`processando`/`concluido`/`erro`), `erro`, `criadoEm`, `concluidoEm`, e não tem `attempts` nem `result`.
2. **`processando` não é `running`.** No sorteio, `processando` é um passo de negócio: o worker marca o estado antes de calcular os pares (`marcar-processando` em `worker/workflows/sortear.ts`), e as regras e a tela usam isso para "sorteio em andamento". Na biblioteca, `running` é gravado pela própria checagem de status e também cobre a retomada depois de queda. Os significados são parecidos, mas não iguais.
3. **Progresso em tempo real por `$streams`.** O sorteio publica progresso num stream (`worker/nucleo/progresso.ts`), com uma regra em `$streams` que olha `auth.ref('$user....sorteios.id')`. A biblioteca não sabe nada de streams; o handler teria de continuar fazendo isso por conta própria. É possível, já que o handler recebe o `db` de admin, mas precisa ser previsto.
4. **Regras que cruzam pedidos.**
   - A criação de um sorteio é negada se há reabertura pendente, e vice-versa.
   - As `entradas` (participantes entrando) são negadas durante um sorteio `pendente`/`processando`.
   - Essas expressões citam os valores de status em português. A biblioteca aceita CEL livre no `allow`, mas todos esses textos mudam junto com os nomes.
5. **`pedidosExclusao` é diferente dos outros.** Não tem campo de erro, o link é com `$users` sem cascade, e o pedido sobrevive ao usuário apagado, como histórico. Com a biblioteca, o link continua sem `onDelete`. Falta decidir se o registro deve continuar existindo depois que a conta some, porque a biblioteca não escreve em command apagado. Hoje o worker apaga o usuário e depois marca `concluido`, e a ordem importa.
6. **Regras novas que a biblioteca gera.** Ela gera `create` com `data.attempts == 0` e `error`/`result`/`finishedAt` nulos, `update: false`, e link só na criação. O app e o MCP teriam de criar os pedidos com `sendCommand`, ou pelo menos gravar os mesmos campos.
7. **MCP.** O `mcp/ferramentas.ts` lê o status dos sorteios para "sorteio em andamento". Ele também precisa migrar.

## Decisões em aberto

1. **Nomes: migrar os dados ou deixar a biblioteca configurável?**
   - **(a) Migrar o app para os nomes da biblioteca.** É preciso um script admin que reescreva os registros existentes, mudar as regras, o app, o MCP e o worker de uma vez, e fazer push do schema com os campos novos antes de apagar os antigos. É o caminho mais limpo; o custo é uma janela de corte com usuários reais.
   - **(b) Dar à biblioteca nomes de campo e de status configuráveis** por command, por exemplo `statusValues: { pending: "pendente", ... }` e `fields: { error: "erro", createdAt: "criadoEm" }`. Não há migração de dados, mas a biblioteca fica mais complexa, e os tipos gerados precisam acompanhar a configuração.
   - **(c) Começar só com os pedidos novos** que surgirem e deixar os três atuais como estão.
2. **Ordem.** Um pedido por vez, começando pela **reabertura**: não tem campos de entrada nem stream, e o fluxo é o mais simples. Depois a exclusão de conta. Por último o sorteio, que tem `processando`, streams e mais regras cruzadas.
3. **Modo de aviso.**
   - Começar em `subscription`, que é o mesmo comportamento de hoje, sem mexer na infra.
   - O `webhook` vem num segundo passo. Ele exige `amigo-worker` com processo `web`, `proxy:enable`, o domínio `amigo-worker.app.tpou.gy`, Let's Encrypt, `WEBHOOK_URL` e a regra de nginx `allow 172.17.0.0/16; deny all;`. O e2e já provou isso num app descartável.
4. **`processando`.** Duas saídas: virar um campo de negócio separado (por exemplo `fase: "calculando"`), ou as regras passarem a olhar o `running` da biblioteca, aceitando que ele também cobre a retomada.
5. **Convivência durante a transição.** O worker roda os dois mundos ao mesmo tempo: a campainha antiga para os pedidos ainda não migrados e o `createRunner` para os migrados. Eles usam o mesmo `ow.db` e precisam de nomes de workflow diferentes, ou do mesmo nome com `version` nova. Lembrete da plataforma: um run de uma versão que nenhum worker registra fica na fila para sempre.
6. **Registros históricos.** Converter todos ou só os `pendente`? E o que fazer com sorteios antigos `concluido`, que as telas mostram?

## Riscos

- **Usuários reais.** O site está com amigos usando. Precisa de uma janela, de backup do Postgres antes (runbook da VPS) e de um rollback testado.
- **Regras.** Um texto CEL errado nas regras cruzadas pode liberar um sorteio durante uma reabertura. Os testes de `pacotes/instant/testes/permissoes.*` precisam ser atualizados e passar contra o app de teste antes do push em produção.
- **Testes de `pacotes/instant` dependem de dados globais do app de teste.** O `debugQuery` avalia todos os `pares` do app. Uma execução interrompida deixa restos que quebram `permissoes.conta.test.ts` ("A vê pares": 7 checagens em vez de 3). Aconteceu hoje e foi resolvido apagando o prefixo que sobrou.
- **Pendências da biblioteca que pesam na migração** (lista completa no plano):
  - `null` de um campo `json` obrigatório chega como `undefined` ao handler;
  - um caso raro no limite de 1000 steps (Instant fora do ar no mesmo instante);
  - `waitForCommand` só rejeita no timeout quando a assinatura falha.
- **TypeScript.** Com o TS 6.0.3 e o `@instantdb/core` 1.0.67, os valores de atributo das consultas saem como `any`, e isso afeta o app e o worker também. A biblioteca fixou o TS 5.9.3 para os próprios testes.

## Sugestão de primeiro passo no novo chat

Fazer o design da migração da **reabertura** sozinha, em modo `subscription`. Para isso, decidir antes o item 1, nomes: (a) migrar os dados ou (b) configurar a biblioteca. A reabertura serve de piloto para a decisão de nomes e para a convivência dos dois mundos no mesmo worker, com pouco risco.
