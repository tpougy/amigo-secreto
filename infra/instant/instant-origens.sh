#!/usr/bin/env bash
# Cadastra no app Instant de PRODUÇÃO as origens autorizadas a receber o redirect do OAuth
# (login com Google). Idempotente: lê as atuais (GET /dash/apps/<id>/auth), adiciona as que faltam
# e remove as "generic" que não estão na lista (a lista abaixo é a fonte da verdade).
# Payload conforme instantdb-rust crates/instant-server/src/routes/dash_apps.rs (de47af8):
#   POST   /dash/apps/<id>/authorized_redirect_origins  {"service":"generic","params":["<host>"]}
#   DELETE /dash/apps/<id>/authorized_redirect_origins/<origemId>
# O admin token do app serve de Bearer em /dash. Nunca imprime o token.
#
# ATENÇÃO: este script REMOVE do app toda origem "generic" que não estiver em `origens` abaixo,
# inclusive as cadastradas à mão no painel ou por outro script. Para adicionar uma origem, ponha-a
# na lista; nunca rode com a lista incompleta.
set -euo pipefail
raiz="$(cd "$(dirname "$0")/../.." && pwd)"
set -a
# shellcheck disable=SC1091
source "$raiz/.env"
set +a

api="${INSTANT_API_URI:-https://instant.tpou.gy}"
app="$INSTANT_APP_ID"
# Front no Worker amigo-secreto (wrangler.jsonc): domínio próprio + endereço reserva *.workers.dev.
origens=(amigo.tpou.gy amigo-secreto.thomaz-pougy.workers.dev localhost:5173)

# O token vai num arquivo de config do curl lido por stdin (não aparece em `ps`).
chamar() { # chamar <método> <caminho> [corpo]
  local metodo="$1" caminho="$2" corpo="${3:-}"
  local args=(-sS --fail-with-body -X "$metodo" "$api$caminho" -H "Content-Type: application/json")
  [ -n "$corpo" ] && args+=(--data "$corpo")
  printf 'header = "Authorization: Bearer %s"\n' "$INSTANT_ADMIN_TOKEN" | curl -K - "${args[@]}"
}

lista=$(chamar GET "/dash/apps/$app/auth" |
  jq -r '(.authorized_redirect_origins // [])[] | select(.service == "generic") | "\(.id) \(.params[0])"')
atuais=$(cut -d' ' -f2 <<<"$lista")

while read -r id host; do
  [ -n "${id:-}" ] || continue
  if ! printf '%s\n' "${origens[@]}" | grep -qxF "$host"; then
    chamar DELETE "/dash/apps/$app/authorized_redirect_origins/$id" >/dev/null
    echo "removida: $host"
  fi
done <<<"$lista"

for host in "${origens[@]}"; do
  if grep -qxF "$host" <<<"$atuais"; then
    echo "já existe: $host"
  else
    chamar POST "/dash/apps/$app/authorized_redirect_origins" \
      "$(jq -nc --arg h "$host" '{service: "generic", params: [$h]}')" >/dev/null
    echo "adicionada: $host"
  fi
done

echo "origens atuais:"
chamar GET "/dash/apps/$app/auth" |
  jq -r '(.authorized_redirect_origins // [])[] | "  \(.service) \(.params | join(" "))"'
