# Spike: hairpin de webhook do Instant na VPS

Data: 2026-11-25. App usado: `amigo-secreto-teste` (entidade `grupos`), webhook para `https://ic-eco.app.tpou.gy/ic/hook` (app Dokku descartável `ic-eco`, já destruído).

## Resultado

- A entrega **chega**: 4 de 4 eventos com status `success` e tentativa `200`. O header `instant-signature` veio presente.
- **IP de origem visto pelo nginx: `172.17.0.2`** (IP do contêiner do Instant na bridge do Docker, não o IP público da VPS). O `X-Forwarded-For` que o app recebe também é `172.17.0.2`; `X-Real-IP` vem vazio. User-Agent: `InstantDB Webhook Sender`.
- O corpo do POST traz só `payloadUrl` (URL em `https://instant.tpou.gy/webhooks/payload/...`) e dados de assinatura; o conteúdo do evento é buscado com `manager.getPayload(webhookId, isn)`.
- **`update` num id novo chega como `create`** (`action: "create"`, `before: null`), igual ao `.create(...)`. Portanto o `sendCommand` (Task 9) pode continuar gravando com `update`; não precisa trocar para `.create`.

## Regra de nginx validada

Arquivo `/home/dokku/<app>/nginx.conf.d/so-a-vps.conf`, seguido de `dokku proxy:build-config <app>`:

```nginx
allow 172.17.0.0/16;
deny all;
```

- Entrega do Instant depois da regra: `200` (histórico do evento via `listEvents`, status `success`).
- `curl -X POST https://ic-eco.app.tpou.gy/ic/hook` da máquina externa: `403`.
- Usar a faixa `172.17.0.0/16` (e não só `172.17.0.2`): o IP do contêiner muda se ele for recriado. Se o Instant estiver numa rede Docker personalizada, conferir o IP no `nginx:access-logs` do app.

## Decisão

**(a)** A entrega chega e a origem é distinguível (bridge do Docker, inalcançável de fora): modo webhook padrão com a regra `allow`/`deny` acima, mais a assinatura.

## Armadilhas

- O `.dockerignore` da raiz exclui `docs`; um Dockerfile que copie de `docs/...` precisa de `!docs/...` no `.dockerignore` (foi preciso temporariamente neste spike; revertido).
- Domínio sem listener some com 502 até o primeiro push; o `letsencrypt:enable` funciona antes do primeiro deploy.

## Limpeza

Webhook apagado (`manager.delete`), app `ic-eco` destruído (`dokku apps:destroy`), dados de teste apagados com `limparTudo`.
