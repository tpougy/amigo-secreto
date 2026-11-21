#!/usr/bin/env bash
# Aplica pacotes/instant/schema.ts e pacotes/instant/perms.ts num app Instant.
# Uso: infra/instant/instant-push.sh <prod|teste> [args extras da CLI]
# Equivale a, na raiz do repo: INSTANT_SCHEMA_FILE_PATH=pacotes/instant/schema.ts \
#   INSTANT_PERMS_FILE_PATH=pacotes/instant/perms.ts INSTANT_CLI_API_URI=$INSTANT_API_URI \
#   INSTANT_APP_ADMIN_TOKEN=... bunx --bun instant-cli@1.0.67 push --app <id> --yes
set -euo pipefail
cd "$(dirname "$0")/../.."
alvo="${1:-}"
[ "$alvo" = prod ] || [ "$alvo" = teste ] || { echo "uso: $0 <prod|teste>" >&2; exit 2; }
shift
export INSTANT_SCHEMA_FILE_PATH=pacotes/instant/schema.ts
export INSTANT_PERMS_FILE_PATH=pacotes/instant/perms.ts
exec infra/instant/instant-cli.sh "$alvo" push "$@"
