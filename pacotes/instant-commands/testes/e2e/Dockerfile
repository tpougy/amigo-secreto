# Runner in webhook mode for the instant-commands e2e (Dokku app ic-teste-worker, disposable).
# Build context: repository root (dokku builder-dockerfile:set ic-teste-worker dockerfile-path pacotes/instant-commands/testes/e2e/Dockerfile).
FROM oven/bun:1.4.5@sha256:3aa040e5445efa09d75bb428a64ba50db13e2b3ac9b6b0c7f145615f62b2ee18
WORKDIR /app
ENV NODE_ENV=production DO_NOT_TRACK=1 OW_DB=/data/ow.db

COPY package.json bun.lock ./
# The root manifest depends on these workspaces, so bun needs them on disk (manifest only).
COPY pacotes/dominio/package.json pacotes/dominio/
COPY pacotes/instant/package.json pacotes/instant/
COPY pacotes/instant-commands/package.json pacotes/instant-commands/
# Dev dependencies stay: the test app's commands import zod.
RUN bun install --frozen-lockfile --filter amigo-secreto --filter instant-commands && rm -rf /root/.bun/install/cache

COPY pacotes/instant-commands pacotes/instant-commands

USER bun
CMD ["bun", "pacotes/instant-commands/testes/e2e/worker.ts"]
