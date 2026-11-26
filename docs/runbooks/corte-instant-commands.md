# Roteiro do corte para o `instant-commands`

> **ATENÇÃO: este roteiro mexe na PRODUÇÃO** (schema e regras do Instant, `amigo-worker`, `amigo-mcp` e o front). **Só execute com o "pode seguir" explícito do Thomaz**, passo a passo. Quem implementou a migração não executa nada daqui por conta própria.

Origem: seção "Corte" de [`docs/superpowers/specs/2026-11-25-migracao-instant-commands-design.md`](../superpowers/specs/2026-11-25-migracao-instant-commands-design.md). Código na branch `feat/migracao-instant-commands`. Os comandos partem da raiz do repositório, na branch já integrada e com o `HEAD` que vai para produção (o `deploy.sh` empurra o `HEAD`).

Premissa: ainda não há uso real, então `sorteios`, `reaberturas` e `pedidosExclusao` estão vazias e não há dados a converter.

## 0. Pré-condições (sem tocar na produção)

1. Árvore limpa, no commit a publicar: `git status` e `git rev-parse --short HEAD`. Anote o commit **anterior** à migração (o alvo do rollback), por exemplo `git merge-base main HEAD` ou o último commit da `main` antes do merge.
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

**Se algum for maior que 0:** não siga. Liste os registros (troque `{}` por consulta que os mostre) e converta cada um **na mão** para o formato novo antes do push, ou espere o pedido terminar com o worker antigo e repita:

| Antigo | Novo |
|---|---|
| `pendente` / `processando` | `pending` / `running` |
| `concluido` | `done` |
| `erro` (status) e o campo `erro` | `failed` e o campo `error` |
| `criadoEm` | `createdAt` |
| `concluidoEm` | `finishedAt` |
| (não existia) | `attempts` (use `0` ou `1`) |

Para `failed`, `error` deve conter a mensagem que o usuário veria. Como o worker novo só trata `pending`/`running`, o mais simples para pedidos antigos sem utilidade é apagá-los (o grupo continua íntegro).

## 3. Schema e regras

Primeiro no app de teste, depois a suíte de permissões, só então produção:

```
infra/instant/instant-push.sh teste
(cd pacotes/instant && bun run test)
infra/instant/instant-push.sh prod
```

Se o teste de permissões falhar, **não** rode o `prod`. O push remove os atributos antigos (`criadoEm`, `erro`, `concluidoEm`) ou os deixa órfãos; ambos servem, pois não há dados.

## 4. Deploy

```
infra/dokku/deploy.sh amigo-worker
infra/dokku/deploy.sh amigo-mcp
infra/front.sh
```

`deploy.sh` empurra o `HEAD` local para o Dokku; o deploy do worker o sobe de novo. O front também publica sozinho no push da `main` (Workers Builds); `infra/front.sh` é o caminho manual. Confirme que o worker subiu:

```
ssh vps-mercurio 'dokku logs amigo-worker --num 100'
```

Procure o início do runner (`ic.*`) e a ausência de erros. Se ele ainda estiver parado (`ps:stop` do passo 2 mantido), `ssh vps-mercurio dokku ps:start amigo-worker`.

## 5. Verificação ponta a ponta

Da raiz (o script limpa o que cria):

```
bun scripts/e2e-producao.ts
```

Esperado: exit 0 (sorteio, reabertura e rodada 2 concluídos). Depois dê uma olhada manual no app: criar grupo, sortear, ver o par.

## Rollback

Reimplante o **commit anterior** de código, schema e regras, nesta ordem:

```
git switch --detach <commit-anterior-à-migração>
infra/instant/instant-push.sh prod
infra/dokku/deploy.sh amigo-worker
infra/dokku/deploy.sh amigo-mcp
infra/front.sh
```

(`git switch --detach` só depois de salvar o trabalho local; volte à branch depois.) **Pedidos criados depois do corte se perdem**, porque o schema antigo não conhece o vocabulário novo; é aceitável enquanto não houver uso real. Se for preciso, restaure o backup do Postgres pelo runbook da VPS.
