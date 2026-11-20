#!/usr/bin/env bash
# Roda a instant-cli contra um app Instant, no diretório atual.
# Uso: infra/instant-cli.sh <prod|teste> <comando> [args]   (ex.: pull, push)
# Lê as credenciais do .env da raiz do repo; nunca imprime tokens.
set -euo pipefail
raiz="$(cd "$(dirname "$0")/.." && pwd)"

alvo="${1:-}"
comando="${2:-}"
[ -n "$comando" ] || { echo "uso: $0 <prod|teste> <comando> [args]" >&2; exit 2; }
shift 2
set -a
# shellcheck disable=SC1091
source "$raiz/.env"
set +a

case "$alvo" in
  prod)  app="$INSTANT_APP_ID";      token="$INSTANT_ADMIN_TOKEN" ;;
  teste) app="$INSTANT_TEST_APP_ID"; token="$INSTANT_TEST_ADMIN_TOKEN" ;;
  *) echo "uso: $0 <prod|teste> <comando> [args]" >&2; exit 2 ;;
esac

INSTANT_CLI_API_URI="$INSTANT_API_URI" INSTANT_APP_ADMIN_TOKEN="$token" \
  bunx --bun instant-cli@1.0.67 "$comando" --app "$app" --yes "$@"
