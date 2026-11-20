# Amigo Secreto

Piloto de amigo secreto (Bun/TypeScript, InstantDB self-hosted).

## Setup

1. `bun upgrade` (Bun 1.4.5)
2. `infra/instant-apps.sh` cria/obtém os apps Instant e grava o `.env` (ver `.env.example`).
3. `bun install`
4. `bun test`

Workspaces: `dominio`, `worker`, `mcp`, `ingestao`, `app`, `painel`.
