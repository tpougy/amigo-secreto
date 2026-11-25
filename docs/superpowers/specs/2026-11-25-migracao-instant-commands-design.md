# Migração do amigo-secreto para o `instant-commands` (design)

**Data:** 2026-11-25 · **Status:** aguardando aprovação (builder check feito; decisões marcadas como "Decisão minha"). Origem: [`docs/ideias/migracao-instant-commands.md`](../../ideias/migracao-instant-commands.md) (análise, decisões e riscos). Biblioteca: `pacotes/instant-commands` (README; specs [`2026-11-25-instant-commands-design.md`](2026-11-25-instant-commands-design.md) e [`2026-11-25-instant-commands-onfailure-design.md`](2026-11-25-instant-commands-onfailure-design.md)).

## Intenção

O worker do amigo-secreto tem uma "campainha" própria (`worker/nucleo/campainha.ts`, `disparar.ts`): assina os pedidos pendentes no Instant e dispara workflows do OpenWorkflow. A biblioteca `instant-commands` nasceu desse padrão e o empacota: um command é declarado num arquivo, e schema, regras, disparo, retomada e acompanhamento saem da declaração.

Esta migração troca a campainha pela biblioteca nos três pedidos que existem (sortear, reabrir grupo, apagar conta). O amigo-secreto vira o primeiro consumidor real da biblioteca, que é o piloto da plataforma: o que der errado aqui melhora a biblioteca antes de outros projetos a usarem.

## Objetivos

- Os três pedidos declarados com `defineCommand`, num módulo compartilhado por app, worker e testes.
- Schema e regras desses pedidos gerados por `commandEntities`/`commandLinks`/`mergePerms`.
- Worker com `createRunner` em modo `subscription`; `campainha.ts` e `disparar.ts` apagados.
- App e e2e criando pedidos com `sendCommand`; app e MCP lendo os status novos.
- Comportamento visível igual ao de hoje: mesmas mensagens, mesmos estados de tela, mesmas regras de negócio.
- Exclusão de conta que não falha em silêncio (reprocessamento diário).
- Um único corte em produção.

## Fora do escopo

- **Modo webhook.** Vem depois, num passo próprio (infra já provada em `docs/spikes/hairpin-webhook.md`).
- **Agendamentos atuais** (`limparHistorico`, `estatisticas`): continuam como workflows comuns do OpenWorkflow; não viram `defineSchedule` agora.
- **Renomear entidades** (`sorteios`, `reaberturas`, `pedidosExclusao` continuam com esses nomes).
- **Mudanças de UI** além das necessárias para os status novos.
- **Atualizar TypeScript** do app/worker (o problema de `any` com TS 6 e `@instantdb/core` 1.0.67 continua).

## Anti-objetivos (falha mesmo que funcione)

- Um sorteio ser criado enquanto uma reabertura está em `running` (regra cruzada olhando só `pending`).
- Uma rodada ficar travada porque um sorteio falhou com a `chave` ocupada.
- Uma pessoa sair do site achando que a conta foi apagada, com o pedido em `failed` e ninguém tentando de novo.
- Regras de produção alteradas sem os testes de `pacotes/instant/testes/permissoes.*` passarem antes no app de teste.

## Restrições

- **Dados de produção** (consulta de 2026-11-25): 4 grupos, todos `aberto`, nenhum sorteado; `sorteios`, `reaberturas` e `pedidosExclusao` vazios. Não há conversão de dados. O corte confere de novo (ver "Corte").
- Versões fixas do repositório: Bun 1.4.5, `@instantdb/core`/`@instantdb/admin` 1.0.67, `openworkflow` 0.11.0.
- Push de schema e regras só por `infra/instant/instant-push.sh <prod|teste>` (a biblioteca já faz push de `commandEntities` pela CLI no app de teste dela, então o caminho funciona).
- Um hook recusa comandos de shell que citem `.env`: variáveis de ambiente só via scripts do `package.json` ou `bun` rodando na raiz.
- Usuários reais podem aparecer a qualquer momento (o grupo "Amigo Livro Permutações" tem 5 participantes).

## Abordagens consideradas

1. **Corte único (escolhida).** Os três pedidos migram numa branch e vão para produção num deploy. Sem dados a converter, não há estado intermediário a proteger, e as regras cruzadas mudam todas juntas.
2. **Um pedido por vez**, com a campainha antiga e o runner convivendo no mesmo worker. Era a recomendação quando havia dados a converter; sem eles, só acrescenta código de convivência e três janelas de corte com regras cruzadas meio migradas.
3. **Configurar a biblioteca com os nomes em português.** Descartada antes: genéricos complexos para sempre por um consumidor só.

## Pré-requisito na biblioteca: evento `command.failed`

O `run.failed` mistura dois significados: diagnóstico técnico (soluço de disparo ou de varredura, erro do gancho, repetições) e o fato de negócio "o pedido terminou `failed`". O worker precisa só do segundo. Antes da migração, a biblioteca ganha um evento novo, num ciclo curto próprio (plano e testes no pacote):

- **Tipo:** `"command.failed"`, acrescentado a `RunnerEvent["type"]`. Chaves: só as que já existem (`type`, `command`, `commandId`, `error`). `error` é a **mensagem gravada** no pedido (a que a tela mostra), nunca a exceção técnica.
- **Quando:** logo depois de a biblioteca gravar `failed` de fato (`markFailed` devolveu `written: true`), em todos os caminhos (`fail`, `error`, `invalid_result`, `invalid_input`, `step_limit`, inclusive quando o `onFailure` lançou ou foi recusado); e no `ic:finish` quando o registro relido já está `failed` (o handler gravou a própria falha com `failCommand`).
- **Quando não:** soluço de disparo, erro de varredura, pedido apagado, pedido já terminado antes, irmãs marcadas pelo handler com `failCommand`.
- **Garantia:** uma vez em operação normal. Num replay, `markFailed` não grava e não emite; se o processo cair entre a gravação e a emissão, o evento se perde (a tela usa o `status`, e o reprocessamento diário cobre a exclusão). No replay raro do `ic:finish` (caso do handler que gravou a própria falha) ele pode se repetir; as reações do worker (`escreverFase`, log) são idempotentes.
- `run.failed` continua como está.
- README: documentar `command.failed` como o sinal para reagir à falha de um pedido e `run.failed` como diagnóstico.

**Status:** implementado (commit 6c633bf; documentação no commit seguinte). Desvios: (1) o handler que se marca `failed` com `failCommand` e **depois lança** não emite o evento; o README recomenda retornar. (2) A garantia é "uma vez em operação normal", não "no máximo uma vez": pode repetir no replay raro do `ic:finish`. (3) O evento sai depois do `run.failed`/`run.invalid_input` do próprio caminho e antes do `run.failed` extra do `onFailure`.

## Desenho

### Vocabulário novo

| Hoje | Depois |
|---|---|
| `pendente` / `processando` / `concluido` / `erro` | `pending` / `running` / `done` / `failed` |
| campo `erro` | `error` |
| `criadoEm` / `concluidoEm` (nos três pedidos) | `createdAt` / `finishedAt` |
| — | `attempts`, `result` |

"Aberto" (em andamento) passa a ser `pending || running` em todo lugar: regras, worker, app e MCP. `running` é gravado pela biblioteca no `ic:check`, antes do handler, e também cobre a retomada depois de uma queda; isso substitui o `processando`, e o passo `marcar-processando` some.

`finishedAt` é gravado também em `failed` (hoje `concluidoEm` fica nulo no erro). As telas que mostram "Sorteio feito em" já só olham sorteios `done`.

### Módulo dos commands: `pacotes/instant/commands.ts`

Exporta `sorteio`, `reabertura`, `exclusaoConta` e a tupla `commands`. Importável no navegador (só `instant-commands`, nunca `instant-commands/worker`). `pacotes/instant/package.json` ganha `instant-commands` (`workspace:*`) e o export `./commands`.

| Command | `name` (workflow) | `entity` | `fields` | `links` | `rateLimit` |
|---|---|---|---|---|---|
| `sorteio` | `sorteio` | `sorteios` | `rodada: i.number()`, `chave: i.string().unique()` | `grupo` → `grupos.sorteios`, `onDelete: "cascade"` | 5 por hora (como hoje) |
| `reabertura` | `reabertura` | `reaberturas` | — | `grupo` → `grupos.reaberturas`, `onDelete: "cascade"` | 5 por hora (como hoje) |
| `exclusaoConta` | `exclusao-conta` | `pedidosExclusao` | — | `usuario` → `$users.pedidosExclusao`, sem `onDelete` | nenhum (como hoje) |

`result`: `sorteio` e `reabertura` devolvem `{ pares: number }` (zod); `exclusaoConta`, `{ anonimizadas, semRefazer, apagadas, grupos }` (números). Os nomes de link (`sorteioGrupo`, `reaberturaGrupo`, `pedidoExclusaoUsuario`) e os labels continuam os de hoje, para que as consultas do app não mudem.

**Regras**, transcritas de `perms.ts` para `bind`/`allow` de cada command, com estas mudanças:

- `sorteio.allow.create`: `ehOrganizador && rodadaValida && chaveCerta && grupoNaoEncerrado && semReaberturaAberta`. O `data.status == 'pendente'` sai (a biblioteca gera `status == 'pending'`), e o `rateLimit` também (a biblioteca o põe primeiro). `semReaberturaAberta` = nenhuma reabertura do grupo em `pending` ou `running`.
- `reabertura.allow.create`: `ehOrganizador && grupoSorteado && semSorteioAberto` (`pending`/`running`).
- `exclusaoConta.allow`: `create`/`view` = `auth.id != null && auth.id in data.ref('usuario.id')`, `delete: "false"`, `link.usuario` = `auth.id == linkedData.id`.
- `view` e `delete` de `sorteio`/`reabertura`: os de hoje (`delete` = organizador, exigido pela cascata).
- `link` dos commands: os de hoje sem o `actions.data == 'create'` (a biblioteca acrescenta).

`perms.ts` passa a exportar `mergePerms(basePerms, commands)` mais `$streams`. Saem de `basePerms`: as entradas `sorteios`, `reaberturas`, `pedidosExclusao`, e `$rateLimits.sorteio`/`reabertura` (os baldes passam a se chamar `sorteios`/`reaberturas`). Os links `sorteios`/`reaberturas` nas regras de `grupos` saem de `grupos.allow.link/unlink`, porque a biblioteca gera o lado reverso; o mesmo para `pedidosExclusao` em `$users`. `participantes.semSorteioEmAndamento` passa a olhar `pending`/`running`.

Um utilitário em `perms.ts`, `emAberto(caminho)`, gera o texto CEL `!('pending' in data.ref(caminho)) && !('running' in data.ref(caminho))` (ou a forma positiva), usado nas três regras cruzadas.

**Schema:** `schema.ts` tira as três entidades e os três links, e espalha `...commandEntities(commands)` e `...commandLinks(commands)`.

### Worker

Arquivos novos, seguindo o README da biblioteca:

- `worker/commands.ts`: `initCommands<AppSchema>()` e o alias `Ctx<C>`.
- `worker/handlers/sorteio.ts`, `reabertura.ts`, `exclusaoConta.ts`: os handlers.
- `worker/schedules/reprocessarExclusoes.ts`.

Os arquivos de hoje em `worker/workflows/` (`sortear.ts`, `reabrirGrupo.ts`, `apagarConta.ts`) dão lugar aos handlers; as funções de negócio que eles já têm (`carregar`, `gravarPares`, `reabrir`, `limparDados`, `dadosDaConta`, `rodadaValida` etc.) são aproveitadas, mudando só leitura e escrita de status. `limparHistorico.ts` e `estatisticas.ts` ficam onde estão.

Comum aos três handlers:

- `version: "1"`, `retryPolicy: RETRY_PASSO_PADRAO` (300 tentativas, 1 s → 60 s, ~5 h).
- `defaultErrorMessage` em português: "Não foi possível concluir o sorteio. Tente de novo.", "Não foi possível reabrir o grupo. Tente de novo.", "Não foi possível apagar a conta."
- Erros de negócio com `ic.fail(MENSAGEM)`, com as mensagens fixas de hoje.
- O padrão de "reler antes de escrever" continua: a biblioteca não escreve status em command apagado, mas as escritas de negócio do handler continuam relendo o estado (`estadoAtual`, `reabrir`), como hoje.

**`sorteio`**

- Passos: `carregar` → `sortear` → `gravar-pares`. Sem `marcar-processando`.
- `carregar` não confere mais o status do pedido (a biblioteca só chama o handler com o command aberto); confere grupo, rodada válida e monta a carga só com ids, como hoje.
- `gravar-pares`: relê o estado; grupo sumiu → retorna sem escrever (o command foi apagado em cascata; a biblioteca pula o resto); grupo encerrado ou participantes mudaram → `ic.fail(…)`; senão uma transação com pares, grupo `sorteado` e `command.complete({ pares })`. Reexecução: se o command já está `done`, o passo devolve a contagem gravada.
- Seed: `seedDoSorteio(segredo, command.id)`. O id do command é o id do sorteio, como hoje. A regra de que os pares nunca saem do passo `sortear` continua.
- `onFailure: liberarChave`, renomeando `chave` para `${chave}:erro:${id}` (com guarda `typeof command.chave === "string"`).
- Stream: `escreverFase` com `streamDoSorteio(command.id)` dentro dos passos (`embaralhando` no início de `sortear`, `sorteando`, `pronto` em `gravar-pares`). A fase `erro` sai do `onEvent` do runner: em `command.failed` (ver "Pré-requisito na biblioteca") com `command === "sorteio"`, `escreverFase(…, "erro", true)`.
- `SORTEIO_SEGREDO` continua obrigatório para o worker subir.

**`reabertura`**

- Passos: `carregar` (grupo existe, `sorteado`, sem sorteio aberto) → `reabrir`.
- `reabrir`: uma transação que apaga os pares do grupo, grava `aberto` + `rodadaBase`, `command.complete({ pares })` e marca as irmãs abertas (`pending`/`running`, id diferente) com `failCommand(reabertura, irma.id, MSG_GRUPO_NAO_SORTEADO)`.
- Falhas de negócio (`MSG_GRUPO_NAO_EXISTE`, `MSG_GRUPO_NAO_SORTEADO`, `MSG_SORTEIO_EM_ANDAMENTO`) com `ic.fail`.

**`exclusaoConta`**

- Passos: `carregar` (id do usuário ou `null`) → `limpar-dados` → `apagar-usuario`. O handler retorna o resumo; a biblioteca grava `done` depois do último passo, o que preserva a ordem de hoje (o usuário é apagado antes de o pedido terminar).
- O pedido sobrevive ao usuário (sem cascade). Depois que o `$users` some, ninguém vê o pedido: fica como histórico, como hoje.

**Reprocessamento das exclusões** (`defineSchedule`, nome `reprocessar-exclusoes`, todo dia às 04:00 de São Paulo)

- Procura pedidos `failed` com o link `usuario` ainda presente.
- Para cada usuário: se ele não tem pedido `pending`/`running`/`done`, e tem menos de 3 pedidos `failed`, cria um pedido novo como admin, ligado ao mesmo usuário, com os campos padrão de um pedido novo (`status: "pending"`, `attempts: 0`, `createdAt`). Com 3 ou mais falhas, não cria e registra o evento `exclusao.desistiu` no log.
- O handler é idempotente (`limparDados` lê o estado atual), então reprocessar é seguro.
- Além disso, o `onEvent` registra `exclusao.falhou` em todo `command.failed` de `exclusao-conta`.

**`worker/main.ts`**

- Mantém: validação de `SORTEIO_SEGREDO`, `init` do admin, `ow` com SQLite em `OW_DB`, `definirLimpeza` e `definirEstatisticas` (registrados no `ow` **antes** de `runner.start()`).
- `createRunner({ ow, db, handlers: [sorteioHandler, reaberturaHandler, exclusaoContaHandler], schedules: [reprocessarExclusoes], trigger: { type: "subscription" }, concurrency: OW_CONCORRENCIA, onEvent })`. O `onEvent` loga cada evento com o `log` atual (prefixo `ic.`) e faz os dois tratamentos acima (stream do sorteio, alerta da exclusão).
- Sai: `ow.newWorker`, as campainhas e o watchdog de reassinatura (a biblioteca reassina sozinha).
- `SIGTERM`/`SIGINT`: `runner.stop()` e sair.

### App

- **Criação dos pedidos com `sendCommand`:**
  - `PainelSorteio.svelte`: `sendCommand(db, sorteio, { rodada, chave: \`${grupo.id}:${rodada}\`, grupo: grupo.id })` e `sendCommand(db, reabertura, { grupo: grupo.id })`. O tratamento do erro `rate-limited` continua (a biblioteca repassa o erro do Instant).
  - `conta/+page.svelte`: `sendCommand(db, exclusaoConta, { usuario: uid })`, mantendo a confirmação no servidor antes do `signOut`.
- **`consultas.ts`**: tipos e funções passam para o vocabulário novo:
  - `SorteioBruto`/`ReaberturaBruta` com `createdAt`, `finishedAt`, `error`.
  - "Andamento" = `pending || running`; "erro" = `failed`; "concluído" = `done`.
  - `reabrindo()` passa a olhar `pending || running` (hoje só `pendente`).
  - `rotuloStatusSorteio` com as chaves novas e os rótulos de hoje ("Na fila", "Sorteando", "Concluído", "Erro").
  - Os nomes dos estados do painel (`EstadoPainel.tipo`: `nunca`, `andamento`, `erro`, `concluido`) são do app e continuam como estão.
- **`PainelSorteio.svelte`**: o indicador de passos usa `pending`/`running`/`done` com os rótulos de hoje; `concluidoEm` → `finishedAt`; `sorteio.erro` → `sorteio.error`.
- Consultas do app que pedem os campos `criadoEm`/`concluidoEm`/`erro` dessas entidades passam aos nomes novos.
- O app ganha a dependência `instant-commands` (`workspace:*`).

### MCP

`mcp/ferramentas.ts`: "sorteio em andamento" = `pending || running`; pares visíveis com sorteio `done`. Sem escrita de pedidos.

### Scripts

`scripts/e2e-producao.ts`: cria sorteio e reabertura com `sendCommand`; espera sair de `pending`/`running`; confere `done`.

### Testes

- **`pacotes/instant/testes/permissoes.*`**: atualizados para o vocabulário e para `sendCommand`. Casos novos obrigatórios:
  - sorteio negado com reabertura em `running` (escrita admin direta do status para simular);
  - reabertura negada com sorteio em `running`;
  - entrada de participante negada com sorteio em `running`;
  - cliente não consegue mudar o status de um command (`update` negado).
- **Verificação no app de teste antes de tudo:** o push de `mergePerms` aceita as regras de link geradas no lado de `$users` (`pedidosExclusao`). *(Decisão minha:)* se o servidor recusar, `perms.ts` remove essas duas regras da saída de `mergePerms` antes de exportar (`$users.allow.link/unlink.pedidosExclusao`), com um comentário explicando, e a biblioteca ganha uma pendência registrada no fim de `docs/superpowers/plans/2026-11-25-instant-commands.md` (opção para não gerar regras reversas em entidades de sistema). A migração não espera a biblioteca.
- **Links de `pares` pelo lado do sorteio:** hoje `perms.ts` tem `sorteios.link.pares: "false"` e `unlink.pares: "false"`. Isso não cabe mais: `mergePerms` recusa `sorteios` no `basePerms`, e `defineCommand` só aceita `allow.link` de links do próprio command (o `parSorteio` é declarado em `pares`). *(Decisão minha:)* confiar no lado `pares` (`pares.allow.link/unlink.sorteio: "false"`, que fica) e no `update: "false"` gerado para `sorteios`, e **provar com teste de permissão** que um cliente (organizador ou membro) não consegue ligar nem desligar `pares` de um sorteio, por nenhum dos dois lados. Se o teste mostrar que consegue, a migração para e a biblioteca precisa aceitar regras de outros links na entidade do command: isso volta para decisão antes de seguir.
- **Worker:** os testes dos workflows viram testes dos handlers, contra o app de teste do amigo-secreto (`@amigo/instant/teste`), cobrindo pelo menos: sorteio feliz; participantes mudaram → `failed` com a mensagem e `chave` liberada; passo que esgota as tentativas (política curta) → `failed` com a mensagem padrão em português e `chave` liberada; grupo apagado durante o run → nada recriado; reabertura feliz com irmã marcada `failed`; exclusão feliz; reprocessamento cria pedido novo para um `failed` e para depois de 3.
- **App e MCP:** os testes de `consultas`, `regras` e `ferramentas` com os valores novos, incluindo `reabrindo()` com `running`.

## Corte

1. Backup do Postgres (runbook da VPS).
2. Parar o worker de produção e confirmar que `sorteios`, `reaberturas` e `pedidosExclusao` continuam vazios. Se houver registro, convertê-lo na mão (status, `error`, `createdAt`, `finishedAt`, `attempts`) antes de seguir.
3. `instant-push.sh prod` (schema e regras), depois de `instant-push.sh teste` e de `permissoes.*` passarem.
4. Deploy do worker, do app e do MCP.
5. Subir o worker e rodar `scripts/e2e-producao.ts`.

Rollback: reimplantar o commit anterior de código, schema e regras. Pedidos criados depois do corte se perdem; aceitável enquanto não houver uso real.

## Fica com quem implementar

- Ordem interna das tarefas (sugestão: commands + schema + regras + testes de permissão → worker → app/MCP/e2e).
- Se a CLI do Instant remove os atributos antigos (`criadoEm`, `erro`, `concluidoEm`) no push ou se eles ficam órfãos; qualquer das duas serve, já que não há dados.
- Se `sendCommand` aceita o `db` do admin para o reprocessamento (ele só usa `transact`); senão, escrever o pedido com `admin.tx` e os mesmos campos padrão.
- Organização interna dos handlers (quanto do código de `workflows/` mover ou reaproveitar).
