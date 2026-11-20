# amigo-worker: OpenWorkflow (SQLite em /data) + campainha do Instant.
# Contexto de build: raiz do repositório (dokku builder-dockerfile:set amigo-worker dockerfile-path worker/Dockerfile).
FROM oven/bun:1.4.5@sha256:3aa040e5445efa09d75bb428a64ba50db13e2b3ac9b6b0c7f145615f62b2ee18
WORKDIR /app
ENV NODE_ENV=production DO_NOT_TRACK=1 OW_DB=/data/ow.db

# Só os manifestos primeiro: a camada de dependências fica em cache entre deploys.
COPY package.json bun.lock ./
COPY dominio/package.json dominio/
COPY worker/package.json worker/
COPY testes/package.json testes/
COPY painel/package.json painel/
RUN bun install --frozen-lockfile --production --filter amigo-secreto --filter @amigo/worker && rm -rf /root/.bun/install/cache

COPY instant.schema.ts ./
COPY dominio dominio
COPY worker worker

USER bun
CMD ["bun", "worker/main.ts"]
