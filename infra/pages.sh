#!/usr/bin/env bash
# Build do SPA (app/) e deploy no Cloudflare Pages (projeto amigo-secreto, branch main),
# com o domínio próprio amigo.tpou.gy. Idempotente. Usa o login OAuth do wrangler; nunca
# imprime o token.
set -euo pipefail
raiz="$(cd "$(dirname "$0")/.." && pwd)"
projeto=amigo-secreto
dominio=amigo.tpou.gy
wr() { bunx --bun wrangler@4 "$@"; }

# 1. build
(cd "$raiz/app" && bun --bun vite build)

# whoami também renova o token OAuth vencido antes de o usarmos na API.
conta=$(wr whoami --json | jq -r '.accounts[0].id')
[ -n "$conta" ] && [ "$conta" != null ] || { echo "wrangler sem login" >&2; exit 1; }

# 2. projeto (se ainda não existe)
if wr pages project list --json | jq -e --arg p "$projeto" 'map(.["Project Name"] // .name) | index($p)' >/dev/null; then
  echo "projeto $projeto já existe"
else
  # --force: o wrangler 4.16x tenta "delegar" para Workers e falha no monorepo; queremos o Pages clássico.
  wr pages project create "$projeto" --production-branch main --force
fi

# 3. deploy
(cd "$raiz/app" && wr pages deploy build --project-name "$projeto" --branch main --commit-dirty=true)

# 4. domínio próprio, pela API (o wrangler não tem comando para isso)
cf() { # cf <método> <caminho> [corpo]
  local token
  token=$(sed -n 's/^oauth_token = "\(.*\)"$/\1/p' "$HOME/.config/.wrangler/config/default.toml")
  local args=(-sS -X "$1" "https://api.cloudflare.com/client/v4/accounts/$conta/pages/projects/$projeto$2"
    -H "Content-Type: application/json")
  [ -n "${3:-}" ] && args+=(--data "$3")
  printf 'header = "Authorization: Bearer %s"\n' "$token" | curl -K - "${args[@]}"
}

if cf GET /domains | jq -e --arg d "$dominio" '.result | map(.name) | index($d)' >/dev/null; then
  echo "domínio $dominio já cadastrado"
else
  cf POST /domains "$(jq -nc --arg d "$dominio" '{name: $d}')" | jq '{success, errors, status: .result.status}'
fi
cf GET /domains | jq -r '.result[] | "domínio \(.name): \(.status) (validação: \(.validation_data.status // "-"), verificação: \(.verification_data.status // "-"))"'
