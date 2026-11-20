# amigo-mcp: servidor MCP (fastmcp + Google) na porta 8080; tokens OAuth em /data/tokens (volume amigo-mcp-data).
# Contexto de build: raiz do repositório (dokku builder-dockerfile:set amigo-mcp dockerfile-path mcp/Dockerfile).
FROM oven/bun:1.4.5@sha256:3aa040e5445efa09d75bb428a64ba50db13e2b3ac9b6b0c7f145615f62b2ee18
WORKDIR /app
ENV NODE_ENV=production DO_NOT_TRACK=1 PORT=8080 MCP_TOKENS_DIR=/data/tokens

# Só os manifestos primeiro: a camada de dependências fica em cache entre deploys.
COPY package.json bun.lock ./
COPY dominio/package.json dominio/
COPY mcp/package.json mcp/
RUN bun install --frozen-lockfile --production --filter amigo-secreto --filter @amigo/mcp && rm -rf /root/.bun/install/cache

COPY instant.schema.ts ./
COPY dominio dominio
COPY mcp mcp

USER bun
EXPOSE 8080
CMD ["bun", "mcp/servidor.ts"]
