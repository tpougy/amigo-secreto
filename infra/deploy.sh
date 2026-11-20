#!/usr/bin/env bash
# Deploy de um app Dokku do projeto: infra/deploy.sh <amigo-worker|amigo-painel|amigo-mcp>
# Empurra o HEAD local; a branch `main` remota de cada app é só o alvo de deploy.
set -euo pipefail
cd "$(dirname "$0")/.."

app=${1:-}
case "$app" in
  amigo-worker | amigo-painel | amigo-mcp) ;;
  *) echo "uso: $0 <amigo-worker|amigo-painel|amigo-mcp>" >&2; exit 2 ;;
esac

if ! git diff --quiet HEAD; then
  echo "aviso: há mudanças não commitadas; só o HEAD ($(git rev-parse --short HEAD)) vai para o deploy" >&2
fi
git push "dokku@vps-mercurio:$app" HEAD:main --force
