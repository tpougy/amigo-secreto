#!/usr/bin/env bash
# Configura o login com Google a partir dos JSONs baixados do Google Cloud (Clientes → Baixar JSON).
#
#   infra/google-oauth.sh                              # pede os dois JSONs (cole; nada aparece na tela)
#   infra/google-oauth.sh --site a.json --mcp b.json   # ou lê de arquivos
#
# 1. Client do SITE → app Instant de produção, como client "google" (provider "google"), pela API
#    /dash com o admin token do .env. Idempotente: se já existe um client "google", ele é trocado.
# 2. Client do MCP → `dokku config:set amigo-mcp GOOGLE_CLIENT_ID/SECRET` (reinicia o app).
#
# Rode no SEU terminal (não pelo `!` do Claude Code): os secrets não devem ir para a conversa.
# Nunca imprime secrets; os valores seguem por stdin (não aparecem em `ps` local).
set -euo pipefail
raiz="$(cd "$(dirname "$0")/.." && pwd)"
set -a
# shellcheck disable=SC1091
source "$raiz/.env"
set +a
api="${INSTANT_API_URI:-https://instant.tpou.gy}"
app="$INSTANT_APP_ID"
discovery=https://accounts.google.com/.well-known/openid-configuration
cb_site=https://instant.tpou.gy/runtime/oauth/callback
cb_mcp=https://amigo-mcp.app.tpou.gy/oauth/callback
origem_site=https://amigo.tpou.gy

arq_site=""; arq_mcp=""
while [ $# -gt 0 ]; do
  case "$1" in
    --site) arq_site="$2"; shift 2 ;;
    --mcp) arq_mcp="$2"; shift 2 ;;
    *) echo "uso: $0 [--site arquivo.json] [--mcp arquivo.json]" >&2; exit 2 ;;
  esac
done

# Lê um JSON colado sem eco: acumula linhas até virar um JSON válido.
ler_json() { # ler_json <rótulo> <arquivo-ou-vazio>
  if [ -n "$2" ]; then cat "$2"; return; fi
  echo "Cole o JSON do client $1 e tecle Enter (não aparece na tela):" >&2
  local buf="" linha
  while IFS= read -rs linha; do
    buf+="$linha"$'\n'
    if jq -e . >/dev/null 2>&1 <<<"$buf"; then printf '%s' "$buf"; echo >&2; return; fi
  done
  echo "entrada terminou sem um JSON válido" >&2; exit 1
}

# Extrai e confere um client "web"; nunca imprime o secret.
validar() { # validar <rótulo> <json> <callback> [origem]
  local j="$2"
  jq -e '.web.client_id and .web.client_secret' >/dev/null <<<"$j" ||
    { echo "$1: JSON sem web.client_id/web.client_secret (é do tipo 'Aplicativo da Web'?)" >&2; exit 1; }
  jq -e --arg u "$3" '(.web.redirect_uris // []) | index($u)' >/dev/null <<<"$j" ||
    { echo "$1: falta o redirecionamento $3 no client do Google" >&2; exit 1; }
  if [ -n "${4:-}" ] && ! jq -e --arg o "$4" '(.web.javascript_origins // []) | index($o)' >/dev/null <<<"$j"; then
    echo "$1: aviso: a origem JavaScript $4 não está no client (o login pode falhar)" >&2
  fi
  echo "$1: client $(jq -r '.web.client_id' <<<"$j" | cut -c1-12)… ok" >&2
}

json_site=$(ler_json "do SITE" "$arq_site"); validar site "$json_site" "$cb_site" "$origem_site"
json_mcp=$(ler_json "do MCP" "$arq_mcp"); validar mcp "$json_mcp" "$cb_mcp"
jq -e --argjson a "$json_site" '.web.client_id != $a.web.client_id' >/dev/null <<<"$json_mcp" ||
  { echo "os dois JSONs são do mesmo client; o MCP precisa de um client próprio" >&2; exit 1; }

# --- 1. Instant (client do site) ---------------------------------------------------------------
# Token e corpo nunca vão para a linha de comando: o token fica num arquivo de config do curl
# temporário (permissão 600, apagado ao sair) e o corpo vai por stdin.
umask 077
cfg_curl=$(mktemp)
trap 'rm -f "$cfg_curl"' EXIT
printf 'header = "Authorization: Bearer %s"\n' "$INSTANT_ADMIN_TOKEN" > "$cfg_curl"
chamar() { # chamar <método> <caminho> [corpo]
  local args=(-sS --fail-with-body -K "$cfg_curl" -X "$1" "$api$2" -H "Content-Type: application/json")
  if [ -n "${3:-}" ]; then
    printf '%s' "$3" | curl "${args[@]}" --data-binary @-
  else
    curl "${args[@]}"
  fi
}

auth=$(chamar GET "/dash/apps/$app/auth")
provider=$(jq -r '(.oauth_service_providers // [])[] | select(.provider_name == "google") | .id' <<<"$auth" | head -1)
if [ -z "$provider" ]; then
  provider=$(chamar POST "/dash/apps/$app/oauth_service_providers" '{"provider_name":"google"}' | jq -r '.provider.id')
  echo "instant: provider google criado" >&2
fi
for antigo in $(jq -r '(.oauth_clients // [])[] | select(.client_name == "google") | .id' <<<"$auth"); do
  chamar DELETE "/dash/apps/$app/oauth_clients/$antigo" >/dev/null
  echo "instant: client google antigo removido" >&2
done
corpo=$(jq -nc --arg p "$provider" --arg d "$discovery" --argjson j "$json_site" \
  '{provider_id: $p, client_name: "google", client_id: $j.web.client_id, client_secret: $j.web.client_secret, discovery_endpoint: $d}')
chamar POST "/dash/apps/$app/oauth_clients" "$corpo" >/dev/null
unset corpo json_site
chamar GET "/dash/apps/$app/auth" |
  jq -r '"instant: clients = " + ([(.oauth_clients // [])[] | "\(.client_name) (\(.client_id[0:12])…)"] | join(", "))' >&2

# --- 2. MCP (Dokku) ------------------------------------------------------------------------------
jq -r '.web.client_id, .web.client_secret' <<<"$json_mcp" |
  ssh vps-mercurio 'read -r id; read -r sec; dokku config:set amigo-mcp GOOGLE_CLIENT_ID="$id" GOOGLE_CLIENT_SECRET="$sec" >/dev/null'
unset json_mcp
echo "mcp: credenciais gravadas; aguardando o app reiniciar…" >&2
for _ in $(seq 1 30); do
  if [ "$(curl -s -m 5 https://amigo-mcp.app.tpou.gy/health)" = "ok" ]; then echo "mcp: /health ok" >&2; exit 0; fi
  sleep 3
done
echo "mcp: /health não respondeu ok em 90 s; veja: ssh vps-mercurio 'dokku logs amigo-mcp --num 50'" >&2
exit 1
