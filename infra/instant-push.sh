#!/usr/bin/env bash
# Aplica instant.schema.ts e instant.perms.ts num app Instant.
# Uso: infra/instant-push.sh <prod|teste> [args extras da CLI]
# Equivale a: INSTANT_CLI_API_URI=$INSTANT_API_URI INSTANT_APP_ADMIN_TOKEN=... \
#   bunx --bun instant-cli@1.0.67 push --app <id> --yes
set -euo pipefail
cd "$(dirname "$0")/.."
alvo="${1:-}"
[ "$alvo" = prod ] || [ "$alvo" = teste ] || { echo "uso: $0 <prod|teste>" >&2; exit 2; }
shift
exec infra/instant-cli.sh "$alvo" push "$@"
