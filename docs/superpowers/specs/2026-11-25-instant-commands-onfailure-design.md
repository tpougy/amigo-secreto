# `instant-commands`: gancho `onFailure` (design)

**Data:** 2026-11-25 · **Status:** implementado. Origem: avaliação da migração do amigo-secreto ([`docs/ideias/migracao-instant-commands.md`](../../ideias/migracao-instant-commands.md)). Complementa a especificação principal ([`2026-11-25-instant-commands-design.md`](2026-11-25-instant-commands-design.md)), seção "Como o command termina".

## Intenção

Quando um command falha, a biblioteca grava `status: "failed"`, `error` e `finishedAt`, e nada mais. Alguns commands reservam algo ao serem criados e precisam devolver essa reserva quando falham. Hoje o handler só consegue fazer isso nas falhas que ele mesmo detecta. Nas falhas inesperadas, quem grava `failed` é a biblioteca, e o handler já parou de rodar.

O gancho `onFailure` permite que o handler acrescente escritas à **mesma transação** em que a biblioteca grava `failed`, em qualquer caminho de falha.

## O caso que motivou

O sorteio do amigo-secreto tem `chave: i.string().unique()` com o valor `<grupoId>:<rodada>`, e a regra de criação exige exatamente esse valor. A chave garante um sorteio por rodada: um duplo clique gera a mesma chave e o segundo `create` é recusado.

Quando o sorteio falha, a chave precisa ser renomeada (`<grupoId>:<rodada>:erro:<sorteioId>`). Senão, o organizador nunca mais consegue pedir aquela rodada. O worker atual faz isso em `marcarErro`. Uma falha inesperada nunca prende a chave no worker atual, porque o pedido continua `pendente` e o worker tenta de novo para sempre.

Com a biblioteca, um passo que esgota as tentativas termina em `failed` com a chave ainda ocupada, e o grupo fica travado naquela rodada:

```
passo esgota as tentativas
  → biblioteca: markFailed grava status/error/finishedAt
  → chave "G7:1" continua no sorteio morto
  → novo create com chave "G7:1" → recusado pela unicidade
  → grupo travado
```

As saídas sem mudar a biblioteca foram descartadas:

- **`try/catch` em volta de `step.run` no handler:** captura também a falha não final de um passo, que é o sinal para o OpenWorkflow agendar a próxima tentativa. O command falharia na primeira oscilação.
- **Tirar a `chave` e confiar só na regra "não há sorteio aberto no grupo":** dois `create` em paralelo passam pela regra. Seria preciso reescrever a defesa contra corrida no fluxo mais sensível do app.
- **Tentativas infinitas:** não cobre bugs nem o limite de 1000 steps.

## Objetivos

- Toda gravação de `failed` feita pela biblioteca pode levar escritas extras do handler, na mesma transação.
- O gancho só descreve escritas (devolve trechos de transação). Quem executa é a biblioteca, uma vez, e só se o command ainda estiver aberto.
- Sem gancho, nada muda: mesmo comportamento, mesmos eventos, mesmos tipos.

## Fora do escopo

- **Efeitos colaterais na falha** (stream, e-mail, métricas). Eles ficam no `onEvent`, que já recebe `run.failed` com o `commandId` e não dá garantia nenhuma.
- **Gancho de sucesso.** No sucesso, o handler já junta suas escritas a `command.complete()`.
- **Falhas gravadas pelo próprio handler** com `failCommand` (ver "Quando o gancho não roda").

## API

```ts
export const sorteioHandler = defineHandler(sortear, executarSorteio, {
  version: "1",
  onFailure: liberarChave,
});

function liberarChave({ db, command }: FailureContext<typeof sortear, AppSchema>) {
  if (typeof command.chave !== "string") return [];
  return [db.tx.sorteios[command.id].update({ chave: `${command.chave}:erro:${command.id}` })];
}
```

**`options.onFailure(ctx)`**

- Devolve `TransactionChunk[]`, ou uma `Promise` dela. Uma lista vazia é válida.
- Pode ler o banco (`ctx.db.query`). **Não deve** chamar `db.transact`, nem produzir outros efeitos: pode ser chamado mais de uma vez (ver "Replay").
- `defineHandler` lança `CommandDefinitionError` se `onFailure` estiver presente e não for uma função.

**Contexto (`FailureContext<C, S>`)**

| Campo | Conteúdo |
|---|---|
| `db` | o admin do Instant do runner, tipado como no `HandlerContext` |
| `command` | `{ id, ...fields }`, relido do banco no momento da falha (sem os campos padrão nem `complete`) |
| `reason` | por que falhou (tabela abaixo) |
| `error` | a mensagem que vai para o campo `error` |

`FailureContext` é uma união discriminada por `reason`. Em `"invalid_input"`, os campos não passaram na validação, então `command` é tipado como `{ id: CommandId<C> } & { [K in keyof Fields<C>]?: unknown }`. Nos outros casos, é `CommandRecord<C>`.

| `reason` | Caminho em `execution.ts` | `error` |
|---|---|---|
| `"fail"` | `ic.fail(msg)` no handler ou num passo | `msg` |
| `"error"` | passo esgotou as tentativas, ou exceção fora de passo | `defaultErrorMessage` |
| `"invalid_result"` | `result` devolvido pelo handler não passou na validação | `defaultErrorMessage` |
| `"invalid_input"` | campos gravados inválidos, detectado no `ic:check` | `defaultErrorMessage` |
| `"step_limit"` | limite de 1000 steps do OpenWorkflow | `defaultErrorMessage` |

Novos tipos exportados por `instant-commands/worker`: `FailureContext`, `FailureReason`. O `initCommands<AppSchema>()` passa a amarrar o schema também no `onFailure` do `defineHandler` que ele devolve.

## Comportamento

### Ordem dentro de uma gravação de falha

`markFailed` passa a receber o gancho, e não trechos prontos, para só chamá-lo quando for de fato gravar:

```
1. relê o command
2. não existe          → run.skipped, não chama o gancho, não grava
3. já está done/failed → não chama o gancho, não grava (comportamento atual)
4. está aberto         → chunks = await onFailure(ctx)
5. db.transact([failedChunk, ...chunks])
```

O passo 4 usa o registro relido no passo 1. Assim o gancho vê o estado atual, e não uma cópia guardada no início do run.

### Replay

O `ic:fail` é um passo e pode ser reexecutado se o processo cair antes de o OpenWorkflow registrar o fim do passo:

- caiu **antes** do `transact`: nada foi gravado; no replay, o gancho é chamado de novo e a gravação acontece;
- caiu **depois** do `transact`: no replay, o command já está `failed`, o passo 3 encerra e o gancho não é chamado.

Logo, cada escrita do gancho é aplicada no máximo uma vez, sempre junto com o `failed`. O gancho em si pode rodar mais de uma vez, e é por isso que ele não deve ter efeitos colaterais.

No caminho `"step_limit"`, a gravação acontece fora de qualquer passo (como hoje), com a mesma sequência de 1 a 5.

### Erros do próprio gancho

- **O gancho lança exceção ou devolve algo que não é um array:** a biblioteca grava `failed` sem os extras e emite `run.failed` com `error: "onFailure: <mensagem>"`. Um gancho com bug não pode deixar o command `running` para sempre.
- **O Instant recusa a transação** (erro da API com status 4xx, por exemplo um trecho que viola unicidade ou referencia um atributo inexistente): a biblioteca tenta de novo só com o `failedChunk` e emite `run.failed` com `error: "onFailure rejected: <mensagem>"`.
- **Outros erros do `transact`** (rede, Instant fora do ar): propagam, e o passo `ic:fail` é refeito como hoje, de novo com o gancho.

O implementador confirma no `@instantdb/admin` 1.0.67 como se distingue uma recusa (4xx) de uma falha de rede, e registra a regra usada na seção de desvios.

### Quando o gancho não roda

- **O command terminou bem** (`done`).
- **O command já não existe** ou já estava terminado quando a falha seria gravada.
- **O handler gravou a falha ele mesmo**, com `failCommand(cmd, command.id, msg)` num `db.transact` próprio, e retornou. O `ic:finish` só registra o evento. Para que o gancho rode, o handler usa `ic.fail(msg)`. A documentação passa a recomendar `ic.fail` para a própria falha e `failCommand` só para *outros* commands (irmãos).
- **Irmãos marcados com `failCommand`.** O handler que os falha inclui as escritas extras deles na própria transação.

## Mudanças no código

| Arquivo | Mudança |
|---|---|
| `src/worker/handler.ts` | `HandlerOptions.onFailure`, `FailureContext`, `FailureReason`; validação em `defineHandler` |
| `src/worker/status.ts` | `markFailed(db, command, id, message, extras?)`, com `extras: (record) => Promise<TransactionChunk[]>` chamado só entre os passos 3 e 5; fallback da recusa 4xx |
| `src/worker/execution.ts` | `failStep` recebe `reason`; os caminhos `fail`, `error`, `invalid_result`, `invalid_input` (no `ic:check`) e `step_limit` passam o gancho a `markFailed` |
| `src/worker/init.ts` | `defineHandler` amarrado ao schema também no tipo do `onFailure` |
| `src/worker/index.ts` | exporta os tipos novos |
| `README.md` | "How a command ends": o gancho, o que ele pode e não pode fazer, `ic.fail` em vez de `failCommand` para a própria falha |
| spec principal | nota em "Como o command termina" apontando para este documento |

## Testes

**Unidade (`status.test.ts`, `handler.test.ts`, `execution`)**

- O gancho é chamado em cada um dos cinco `reason`, com `error` e `command` corretos.
- O gancho não é chamado com o command já `done`/`failed` ou apagado.
- Os extras vão no mesmo `transact` que o `failedChunk` (um só `transact` registrado no db falso).
- Gancho que lança, ou devolve um não array: `failed` gravado sem extras, `run.failed` com prefixo `onFailure:`.
- Recusa 4xx com extras: segunda tentativa só com o `failedChunk`. Erro de rede: propaga.
- Sem gancho: o comportamento e os eventos dos testes atuais não mudam.
- `defineHandler` com `onFailure` que não é função: `CommandDefinitionError`.

**Tipos (`testes/tipos/handler.ts`)**

- `command` tem os campos tipados em `"fail"` e `"error"`, e `unknown` em `"invalid_input"`.
- Devolver algo que não é trecho de transação é erro de compilação.

**Integração (`testes/integracao/execucao.test.ts`, app de teste)**

- Command com campo `unique`. O handler falha com o passo esgotando as tentativas (política curta). O gancho renomeia o campo. Um segundo command com o valor original é aceito.
- O mesmo com `ic.fail`.
- Gancho que devolve um trecho recusado pelo Instant: o command termina `failed` e o campo continua com o valor original.

## Uso no amigo-secreto

Com o gancho, o handler do sorteio não precisa mais de `marcarErro`:

- **erros de negócio:** `ic.fail(MSG_PARTICIPANTES_MUDARAM)` e os outros;
- **chave:** `onFailure: liberarChave`, como no exemplo da API, cobrindo também as falhas inesperadas;
- **fase "erro" do stream:** no `onEvent` (`run.failed` com `command === "sorteio"`), em melhor esforço. A tela já usa o `status` quando o stream não fecha.

A reabertura e a exclusão de conta não reservam nada e não usam o gancho.

## Questões em aberto

- **`invalid_input` deve chamar o gancho?** A proposta diz que sim, com campos `unknown`, porque um command inválido também pode estar segurando uma reserva. A alternativa é não chamar, e o gancho fica com tipos mais simples.
- **Fallback na recusa 4xx.** A proposta grava `failed` sem os extras, para o command não ficar `running`. O custo é a reserva continuar presa nesse caso raro, avisado só pelo `onEvent`.

## Status da implementação e desvios

Implementado em `pacotes/instant-commands` (`src/worker/handler.ts`, `status.ts`, `execution.ts`). Desvios em relação à proposta:

1. **Testes de `execution` são de integração**, seguindo o padrão do pacote, e não de unidade.
2. **`isInstantRejection` não precisou mudar.** O servidor confirmou que o conflito de unicidade chega como `InstantAPIError` 400, com `body.type` `record-not-unique`.
3. **Regra acrescentada** (não estava na proposta): um elemento do array sem `__ops` é tratado como erro do gancho, com `error: "onFailure: must return transaction chunks"`.
4. **Campos gravados como `null`** são omitidos de `ctx.command`, como os ausentes.
5. **Novo script `test:one`** no `package.json` do pacote, para rodar um arquivo de teste isolado.
