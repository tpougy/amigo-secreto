#!/usr/bin/env bash
# Garante os apps Instant (produção e teste) e grava as credenciais em .env.
# Idempotente. Não imprime tokens.
set -euo pipefail
cd "$(dirname "$0")/.."

HOST=vps-mercurio
NOVO=~/pessoal/vps/bin/instant-new-app

for nome in amigo-secreto amigo-secreto-teste; do
  if ! ssh "$HOST" test -e "/root/instant-apps/$nome.env"; then
    "$NOVO" "$nome" >/dev/null
  fi
done

le() { # le <nome> <chave>
  ssh "$HOST" "grep -m1 '^$2=' /root/instant-apps/$1.env" | cut -d= -f2-
}

umask 077
{
  echo "INSTANT_API_URI=https://instant.tpou.gy"
  echo "INSTANT_APP_ID=$(le amigo-secreto app_id)"
  echo "INSTANT_ADMIN_TOKEN=$(le amigo-secreto admin_token)"
  echo "INSTANT_TEST_APP_ID=$(le amigo-secreto-teste app_id)"
  echo "INSTANT_TEST_ADMIN_TOKEN=$(le amigo-secreto-teste admin_token)"
} > .env.tmp
mv .env.tmp .env
echo "ok: .env atualizado"
# confere que as 5 variáveis têm valor (sem imprimir valores)
validas=$(grep -c '^INSTANT_[A-Z_]*=.\+' .env)
echo "variáveis preenchidas: $validas/5"
[ "$validas" = 5 ]
