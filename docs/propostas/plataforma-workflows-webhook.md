# Proposta: webhook por projeto na plataforma de workflows

**Data:** 2026-11-25 · **Status:** texto proposto para `~/pessoal/vps/docs/plataforma-workflows.md`. Não foi aplicado no repositório da VPS; quem decide é o Thomaz. Origem: a biblioteca `instant-commands` (`pacotes/instant-commands`, spec em `docs/superpowers/specs/2026-11-25-instant-commands-design.md`).

## Padrão: aviso por webhook

O worker de cada projeto descobre que há trabalho novo por um webhook do Instant, em vez de manter uma assinatura aberta. O Instant faz um POST assinado (Ed25519) para o worker a cada registro criado; o worker confere a assinatura, lê o registro no banco e dispara o workflow.

**Um projeto = um app no Instant = um worker = um domínio = um webhook.** Nada de roteador central de webhooks, pelo mesmo princípio de "nada de OpenWorkflow central".

| Projeto | App Dokku | `WEBHOOK_URL` |
|---|---|---|
| amigo-secreto | `amigo-worker` | `https://amigo-worker.app.tpou.gy/ic/hook` |
| `<projeto>` | `<projeto>-worker` | `https://<projeto>-worker.app.tpou.gy/ic/hook` |

O domínio "bonito" do projeto (ex.: `amigo.tpou.gy`, o front na Cloudflare) não muda. O endereço do worker só é chamado pelo Instant; o navegador nunca fala com ele.

## Passos no Dokku, por projeto

```sh
dokku apps:create <projeto>-worker
dokku ps:scale <projeto>-worker web=1 worker=0      # o worker passa a ser o processo web (recebe o POST)
dokku proxy:enable <projeto>-worker
dokku domains:set <projeto>-worker <projeto>-worker.app.tpou.gy
dokku config:set <projeto>-worker WEBHOOK_URL=https://<projeto>-worker.app.tpou.gy/ic/hook
dokku storage:mount <projeto>-worker /var/lib/dokku/data/storage/<projeto>-worker:/data   # banco do OpenWorkflow
# regra de nginx (próxima seção), depois:
dokku letsencrypt:enable <projeto>-worker
dokku proxy:build-config <projeto>-worker
```

- O Dokku injeta `PORT`; a biblioteca usa essa porta e atende `POST /ic/hook` e `GET /health` (o `checks` do deploy sem interrupção usa o `/health`).
- Hoje o `amigo-worker` sobe com `proxy:disable` e `web=0 worker=1` (`infra/dokku/provisionar.sh`); com o webhook ele passa a precisar do proxy.
- O `letsencrypt:enable` funciona antes do primeiro deploy, mas o domínio sem listener responde 502 até o primeiro push.
- Um Dockerfile que copie de `docs/...` precisa de `!docs/...` no `.dockerignore` da raiz, que exclui `docs`.
- O `bun install --frozen-lockfile` precisa dos manifestos de todos os workspaces de que a raiz depende (`pacotes/dominio`, `pacotes/instant`), mesmo filtrando só um.

## Trecho de nginx

Arquivo `/home/dokku/<projeto>-worker/nginx.conf.d/so-a-vps.conf`, seguido de `dokku proxy:build-config <projeto>-worker`:

```nginx
allow 172.17.0.0/16;
deny all;
```

- A internet recebe `403`; o Instant, que fica num contêiner da própria VPS, passa. O worker só tem `/ic/hook` e `/health`, então restringir o app inteiro não atrapalha (o `/health` também dá `403` de fora; a checagem do Dokku é interna).
- **Por que `/16`:** o nginx enxerga a entrega como vinda de `172.17.0.2`, o IP do contêiner do Instant na bridge padrão do Docker (não o IP público da VPS). Esse IP muda se o contêiner for recriado, então a regra usa a faixa inteira da bridge. Se o Instant estiver numa rede Docker personalizada, conferir o IP no `dokku nginx:access-logs <app>` e ajustar a faixa.
- É um filtro grosso: qualquer contêiner da bridge passa. **A proteção de verdade é a assinatura Ed25519**, que a rota confere em todo POST (assinatura inválida: `401`).

## Nunca ligar `INSTANT_WEBHOOK_ALLOW_INSECURE`

Essa chave do servidor do Instant é global para todos os apps. Com ela, um token de admin vazado de qualquer projeto vira acesso à rede interna da VPS: o Instant faria POSTs para serviços internos e os primeiros 256 caracteres da resposta ficariam gravados no histórico do evento, legível pelo mesmo token. O caminho acima (HTTPS público + `allow`/`deny` + assinatura) não precisa dela. Proibida em produção.

## Evidências

**Hairpin (spike, 2026-11-25; `docs/spikes/hairpin-webhook.md`).** App descartável `ic-eco`, webhook do app `amigo-secreto-teste`: 4 de 4 entregas chegaram (`success`, tentativa `200`, header `instant-signature` presente). IP de origem visto pelo nginx: `172.17.0.2`. Depois da regra `allow`/`deny`, a entrega do Instant continuou `200` e um `curl -X POST` de fora deu `403`. O corpo do POST traz só `payloadUrl` e dados de assinatura; o conteúdo vem de `manager.getPayload`. Um `update` num id novo chega como `create`.

**E2E (Task 17, 2026-11-25).** App `ic-teste-worker` (`ic-teste-worker.app.tpou.gy`, Let's Encrypt, volume em `/data`, regra acima), runner em modo webhook. 3 de 3 testes passaram (~110 s):
- command chega a `done` em menos de 10 s pelo webhook;
- worker parado (`dokku ps:stop`): o command fica `pending`, e depois de `ps:start` a varredura de partida o conclui em menos de 30 s;
- `POST` direto da internet em `/ic/hook`: `403`.

App, volume e webhook de teste foram destruídos no fim.

## O que a biblioteca faz sozinha

- Cadastra e mantém o webhook no Instant a cada `runner.start()` (`namespaces` = entidades dos handlers, `actions: ["create"]`), inclusive reativando um webhook que o Instant tenha desativado. Um command novo não exige mexer no Instant.
- Faz uma varredura dos pendentes ao subir e a cada 5 minutos, para cobrir avisos perdidos e o tempo em que o worker esteve fora.
- Nunca responde `410` (o Instant desativaria o webhook); erro ao disparar vira `503`, e o Instant reenvia pelo calendário dele.
