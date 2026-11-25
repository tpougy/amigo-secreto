#!/usr/bin/env bash
# Applies testes/app/schema.ts and testes/app/perms.ts to the test app (instant-commands-teste).
set -euo pipefail
cd "$(dirname "$0")/../../.."
export INSTANT_SCHEMA_FILE_PATH=pacotes/instant-commands/testes/app/schema.ts
export INSTANT_PERMS_FILE_PATH=pacotes/instant-commands/testes/app/perms.ts
exec infra/instant/instant-cli.sh ic push "$@"
