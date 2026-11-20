# amigo-painel: @openworkflow/dashboard sob Bun, lendo o mesmo /data/ow.db do worker.
# Contexto de build: raiz do repositório (dokku builder-dockerfile:set amigo-painel dockerfile-path painel/Dockerfile).
FROM oven/bun:1.4.5@sha256:3aa040e5445efa09d75bb428a64ba50db13e2b3ac9b6b0c7f145615f62b2ee18 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY dominio/package.json dominio/
COPY worker/package.json worker/
COPY testes/package.json testes/
COPY painel/package.json painel/
# hoisted: os pacotes ficam em node_modules/<nome>, fáceis de copiar um a um abaixo.
RUN bun install --frozen-lockfile --production --filter @amigo/painel --linker hoisted

# O servidor do painel (.output do TanStack Start/Nitro) já vem empacotado; em runtime ele só
# importa @openworkflow/cli/internal (loadConfig via jiti) e o config importa openworkflow/sqlite.
# Copiar só esse fecho mantém a imagem com ~11 MB de node_modules em vez de ~350 MB.
FROM oven/bun:1.4.5@sha256:3aa040e5445efa09d75bb428a64ba50db13e2b3ac9b6b0c7f145615f62b2ee18
WORKDIR /app
ENV NODE_ENV=production DO_NOT_TRACK=1 PORT=3999 OW_DB=/data/ow.db
COPY --from=deps /app/node_modules/@openworkflow/dashboard node_modules/@openworkflow/dashboard
COPY --from=deps /app/node_modules/@openworkflow/cli node_modules/@openworkflow/cli
COPY --from=deps /app/node_modules/jiti node_modules/jiti
COPY --from=deps /app/node_modules/openworkflow node_modules/openworkflow
COPY --from=deps /app/node_modules/cron-parser node_modules/cron-parser
COPY --from=deps /app/node_modules/luxon node_modules/luxon
COPY painel/openworkflow.config.ts ./

USER bun
CMD ["bun", "--bun", "node_modules/@openworkflow/dashboard/bin.mjs"]
