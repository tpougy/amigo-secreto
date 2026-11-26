# Roteiro do corte para o `instant-commands`

> **ATENÇÃO: este roteiro mexe na PRODUÇÃO** (schema e regras do Instant, `amigo-worker`, `amigo-mcp` e o front). **Só execute com o "pode seguir" explícito do Thomaz**, passo a passo. Quem implementou a migração não executa nada daqui por conta própria.

Origem: seção "Corte" de [`docs/superpowers/specs/2026-11-25-migracao-instant-commands-design.md`](../superpowers/specs/2026-11-25-migracao-instant-commands-design.md). Código na branch `feat/migracao-instant-commands`. Os comandos partem da raiz do repositório, **na branch `feat/migracao-instant-commands`, ainda não integrada à `main`**, com o `HEAD` que vai para produção.

**Ordem do merge (importante):** um push na `main` dispara o Cloudflare Workers Builds, que publica `app/` na hora (`infra/front.sh:2-3`). Se a `main` receber a migração antes do push de schema/regras, o front novo ficaria no ar falando `sendCommand` com um backend que ainda não o conhece. Por isso **todos os passos até o deploy do front rodam do `HEAD` da branch** (`infra/dokku/deploy.sh` empurra o `HEAD` local; `infra/front.sh` builda `app/` localmente e publica com o `wrangler`; ambos independem da `main`), e o merge/push da `main` só acontece no passo 7, **depois** do front e do e2e. Alternativa (menos recomendada): pausar o Workers Builds no painel da Cloudflare durante o corte e fazer o merge antes.

Premissa: ainda não há uso real, então `sorteios`, `reaberturas` e `pedidosExclusao` estão vazias e não há dados a converter.

## 0. Pré-condições (sem tocar na produção)

1. Árvore limpa, no commit a publicar: `git status` e `git rev-parse --short HEAD`. Anote o commit **anterior** à migração (o alvo do rollback): `git merge-base main HEAD` (a `main` ainda não tem a migração).
2. **Construir as duas imagens Docker localmente.** Os Dockerfiles passaram a copiar `pacotes/instant-commands` e `pacotes/instant/commands.ts` e a instalar com `--filter instant-commands`, e isso **nunca foi verificado** (a máquina de desenvolvimento não tinha daemon do Docker):
   ```
   docker build -f worker/Dockerfile -t amigo-worker:corte .
   docker build -f mcp/Dockerfile -t amigo-mcp:corte .
   ```
   Se qualquer build falhar, **pare** e corrija antes de seguir.
3. Suítes (usam o app Instant **de teste**):
   ```
   (cd pacotes/instant && bun run test)
   (cd worker && bun run test)
   (cd app && bun run test && bun run check)
   (cd mcp && bun run test)
   ```
4. **Runs abertos dos workflows antigos.** O worker novo não registra mais `sortear`, `apagar-conta` e `reabrir-grupo`. Confira, só leitura, se o `ow.db` do volume tem runs deles ainda não terminados (o volume `amigo-workflows` fica em `/var/lib/dokku/data/storage/amigo-workflows`, montado em `/data`). A VPS não tem `sqlite3`, então a consulta roda num contêiner do Bun com o volume montado só para leitura:
   ```
   ssh vps-mercurio "docker run --rm -v /var/lib/dokku/data/storage/amigo-workflows:/d:ro --entrypoint bun oven/bun:1.4.5 -e \"import {Database} from 'bun:sqlite'; const db=new Database('/d/ow.db',{readonly:true}); console.log(db.query(\\\"select workflow_name, status, count(*) n from workflow_runs where workflow_name in ('sortear','apagar-conta','reabrir-grupo') and status in ('pending','running','sleeping') group by 1,2\\\").all()); console.log(db.query('select workflow_name, cron from workflow_schedules').all());\""
   ```
   - **Primeira lista vazia:** nada a fazer. Com linhas, **podem ser ignoradas**: o worker novo pega esses runs, não encontra o workflow registrado e os marca `failed`. Os pedidos deles já sumiram ou, se existirem, são tratados no passo 2. Anote o que apareceu.
   - **Segunda lista (agendamentos guardados):** em 2026-11-25 eram só `limpar-historico` e `atualizar-estatisticas`, que continuam no worker novo. Um agendamento de workflow que não existe mais geraria runs marcados `failed`, só ruído nos logs.

## 1. Backup do Postgres

Passo **manual**, pelo runbook de backup do repositório da VPS (fora deste repo; não está copiado aqui). Confirme que o dump existe e anote onde ficou antes de seguir.

## 2. Parar o worker de produção e conferir as três entidades

```
ssh vps-mercurio dokku ps:stop amigo-worker
```

Consulta admin de produção (a raiz tem o arquivo de ambiente com `INSTANT_APP_ID`, `INSTANT_ADMIN_TOKEN` e `INSTANT_API_URI`, que o Bun carrega sozinho; o comando não o cita):

```
bun -e '
import { init } from "@instantdb/admin";
const db = init({ appId: process.env.INSTANT_APP_ID!, adminToken: process.env.INSTANT_ADMIN_TOKEN!, apiURI: process.env.INSTANT_API_URI! });
const r = await db.query({ sorteios: {}, reaberturas: {}, pedidosExclusao: {} });
console.log(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.length])));
'
```

Esperado: `{ sorteios: 0, reaberturas: 0, pedidosExclusao: 0 }`.

**Se algum for maior que 0:** não siga para o push. O caminho **principal é apagar** os registros quando forem de teste (não reais): liste-os (troque `{}` por consulta que os mostre) e apague com `db.transact(db.tx.<entidade>[id].delete())`; o grupo continua íntegro. Só converta na mão se forem pedidos reais, ou espere o pedido terminar com o worker antigo e repita.

Conversão (campos de status e datas):

| Antigo | Novo |
|---|---|
| `pendente` / `processando` | `pending` / `running` |
| `concluido` | `done` |
| `erro` (status) e o campo `erro` | `failed` e o campo `error` |
| `criadoEm` | `createdAt` |
| `concluidoEm` | `finishedAt` |
| (não existia) | `attempts` (use `0` ou `1`) |

A tabela **não é completa**. Antes de converter, confira os campos obrigatórios do schema novo em `pacotes/instant-commands/src/schema.ts` e os campos do próprio comando em `pacotes/instant/commands.ts`: `sorteios` exige também `rodada` e `chave` (`<grupoId>:<rodada>`, única), e cada comando tem os seus. Registro que falte um campo obrigatório quebra o worker novo ou a regra. Para `failed`, `error` deve conter a mensagem que o usuário veria. Como o worker novo só trata `pending`/`running`, pedidos antigos sem utilidade devem ser apagados, não convertidos.

## 3. Schema e regras

Primeiro no app de teste, depois a suíte de permissões, só então produção:

```
infra/instant/instant-push.sh teste
(cd pacotes/instant && bun run test)
infra/instant/instant-push.sh prod
```

**Logo após o `instant-push.sh prod`, repita a consulta de contagem do passo 2.** Entre a primeira contagem e este push, o front antigo e as regras antigas continuam no ar, e alguém pode ter criado um pedido `pendente` com o worker parado: um sorteio assim mantém a `chave` e trava a rodada, e uma exclusão nunca seria pega (o reprocessamento diário só olha `failed`). Daqui em diante as regras novas rejeitam `pendente` (o vocabulário novo é `pending`), então esta segunda contagem fecha a janela. Se algo aparecer, aplique o mesmo passo do 2: **apague** (principal) ou converta, e só então siga para o deploy.

Se o teste de permissões falhar, **não** rode o `prod`. O push remove os atributos antigos (`criadoEm`, `erro`, `concluidoEm`) ou os deixa órfãos; ambos servem, pois não há dados.

## 4. Deploy (do `HEAD` da branch)

```
infra/dokku/deploy.sh amigo-worker
infra/dokku/deploy.sh amigo-mcp
infra/front.sh
```

`deploy.sh` empurra o `HEAD` local para o Dokku (não depende da `main`); `infra/front.sh` builda `app/` localmente e publica com o `wrangler`. O front novo só vai ao ar aqui, depois do schema e das regras.

## 5. Worker no ar

1. Veja se o worker subiu e se não há erros:
   ```
   ssh vps-mercurio 'dokku logs amigo-worker --num 100'
   ```
   Procure o início do runner (`ic.*`).
2. **Passo explícito:** o `ps:stop` do passo 2 pode manter o app parado mesmo depois do `deploy.sh` (não assuma que o deploy o ligou). Confira com `ssh vps-mercurio dokku ps:report amigo-worker` e, se `Running: false`, suba:
   ```
   ssh vps-mercurio dokku ps:start amigo-worker
   ```
3. Repita o `ps:report` até `Running: true`.

## 6. Verificação ponta a ponta

Da raiz (o script limpa o que cria):

```
bun scripts/e2e-producao.ts
ssh vps-mercurio dokku ps:report amigo-worker
```

Esperado: exit 0 (sorteio, reabertura e rodada 2 concluídos) e o worker `Running: true` depois do e2e. Depois dê uma olhada manual no app: criar grupo, sortear, ver o par.

## 7. Merge na `main`

Só agora, com o corte verificado: integre a branch na `main` e faça o push. O Workers Builds vai publicar `app/` da `main`, que é o mesmo front já no ar. Se algo falhou antes, **não** faça o merge.

## Rollback

Reimplante o **commit anterior** de código, schema e regras, nesta ordem:

```
git switch --detach <commit-anterior-à-migração>
infra/instant/instant-push.sh prod
infra/dokku/deploy.sh amigo-worker
infra/dokku/deploy.sh amigo-mcp
infra/front.sh
```

(`git switch --detach` só depois de salvar o trabalho local; volte à branch depois.) Notas:

- O worker só volta a rodar depois do `deploy.sh amigo-worker`. Se o rollback abortar no meio (por exemplo no `instant-push.sh`), o worker **continua parado**: refaça os passos ou suba com `ssh vps-mercurio dokku ps:start amigo-worker` conforme o que já estiver revertido.
- O próximo push na `main` republica o que estiver na `main` (Workers Builds). Se a migração já tiver sido integrada, o front novo volta a ser publicado por cima do rollback: reverta a `main` (ou pause o Workers Builds) antes de qualquer push nela.

**Pedidos criados depois do corte se perdem**, porque o schema antigo não conhece o vocabulário novo; é aceitável enquanto não houver uso real. Se for preciso, restaure o backup do Postgres pelo runbook da VPS.
