#!/usr/bin/env bash
# Provisiona na VPS os apps Dokku `amigo-worker` e `amigo-painel` e o volume `amigo-workflows`.
# Idempotente: cada passo confere o estado antes de mudar; a última linha diz quantas mudanças houve.
# Segredos (app_id/admin_token do Instant de produção) são lidos na própria VPS de
# /root/instant-apps/amigo-secreto.env e nunca passam por esta máquina nem pela saída.
set -euo pipefail

HOST=vps-mercurio

ssh "$HOST" 'bash -s' <<'REMOTO'
set -euo pipefail

VOL=amigo-workflows
VOL_DIR=/var/lib/dokku/data/storage/$VOL
UID_BUN=1000:1000 # usuário `bun` da imagem oven/bun
MUDANCAS=0

ok() { echo "  ok: $*"; }
mudou() { echo "  mudou: $*"; MUDANCAS=$((MUDANCAS + 1)); }

# rep <plugin> <app> <flag>: um valor do `<plugin>:report`, sem espaços nas pontas.
rep() { dokku "$1:report" "$2" "--$3" 2>/dev/null | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'; }

# cfg <app> K=V...: só faz config:set das chaves cujo valor difere. Imprime só os nomes.
cfg() {
  local app=$1 kv k v
  shift
  local muda=()
  for kv in "$@"; do
    k=${kv%%=*}
    v=${kv#*=}
    [ "$(dokku config:get "$app" "$k" 2>/dev/null || true)" = "$v" ] || muda+=("$kv")
  done
  if ((${#muda[@]})); then
    dokku config:set --no-restart "$app" "${muda[@]}" >/dev/null
    mudou "$app config:set ${muda[*]%%=*}"
  else
    ok "$app config ($(printf '%s ' "${@%%=*}"))"
  fi
}

echo "== volume $VOL"
if dokku storage:info "$VOL" >/dev/null 2>&1; then ok "storage $VOL"; else
  dokku storage:create "$VOL" >/dev/null
  mudou "storage:create $VOL"
fi
if [ "$(stat -c %u:%g "$VOL_DIR")" = "$UID_BUN" ]; then ok "dono $UID_BUN"; else
  chown "$UID_BUN" "$VOL_DIR"
  mudou "chown $UID_BUN $VOL_DIR"
fi

for APP in amigo-worker amigo-painel; do
  DIR=${APP#amigo-}
  echo "== $APP"
  if dokku apps:exists "$APP" >/dev/null 2>&1; then ok "app"; else
    dokku apps:create "$APP" >/dev/null
    mudou "apps:create"
  fi
  # Build com Dockerfile e contexto = repositório inteiro.
  if [ "$(rep builder "$APP" builder-selected)" = dockerfile ]; then ok "builder dockerfile"; else
    dokku builder:set "$APP" selected dockerfile >/dev/null
    mudou "builder:set selected dockerfile"
  fi
  if [ "$(rep builder-dockerfile "$APP" builder-dockerfile-dockerfile-path)" = "$DIR/Dockerfile" ]; then
    ok "dockerfile-path $DIR/Dockerfile"
  else
    dokku builder-dockerfile:set "$APP" dockerfile-path "$DIR/Dockerfile" >/dev/null
    mudou "dockerfile-path $DIR/Dockerfile"
  fi
  if [ "$(rep proxy "$APP" proxy-enabled)" = false ]; then ok "proxy desligado"; else
    dokku proxy:disable "$APP" >/dev/null
    mudou "proxy:disable"
  fi
  if dokku storage:list "$APP" 2>/dev/null | grep -q "$VOL_DIR:/data"; then ok "volume em /data"; else
    dokku storage:mount "$APP" "$VOL" --container-dir /data >/dev/null
    mudou "storage:mount $VOL /data"
  fi
done

echo "== amigo-worker (processo worker, sem web)"
if [ "$(rep ps amigo-worker ps-procfile-path)" = worker/Procfile ]; then ok "procfile-path"; else
  dokku ps:set amigo-worker procfile-path worker/Procfile >/dev/null
  mudou "ps:set procfile-path worker/Procfile"
fi
if [ "$(rep ps amigo-worker ps-stop-timeout-seconds)" = 30 ]; then ok "stop-timeout 30"; else
  dokku ps:set amigo-worker stop-timeout-seconds 30 >/dev/null
  mudou "ps:set stop-timeout-seconds 30"
fi
ESCALA=$(dokku ps:scale amigo-worker 2>/dev/null | awk '$1 ~ /^(web|worker):?$/ {gsub(":","",$1); print $1"="$2}' | sort | tr '\n' ' ')
if [ "$ESCALA" = "web=0 worker=1 " ]; then ok "escala web=0 worker=1"; else
  dokku ps:scale --skip-deploy amigo-worker web=0 worker=1 >/dev/null
  mudou "ps:scale web=0 worker=1 (antes: ${ESCALA:-vazio})"
fi
cfg amigo-worker INSTANT_API_URI=https://instant.tpou.gy DO_NOT_TRACK=1 OW_DB=/data/ow.db
# Segredos: lidos aqui, na VPS, e comparados/gravados sem ecoar valores.
SEGREDOS=/root/instant-apps/amigo-secreto.env
app_id=$(grep -m1 '^app_id=' "$SEGREDOS" | cut -d= -f2-)
admin_token=$(grep -m1 '^admin_token=' "$SEGREDOS" | cut -d= -f2-)
[ -n "$app_id" ] && [ -n "$admin_token" ] || { echo "faltam app_id/admin_token em $SEGREDOS" >&2; exit 1; }
cfg amigo-worker INSTANT_APP_ID="$app_id" INSTANT_ADMIN_TOKEN="$admin_token"
unset app_id admin_token

echo "== amigo-painel (127.0.0.1:3999, só por túnel)"
PORTA="-p 127.0.0.1:3999:3999"
if rep docker-options amigo-painel docker-options-deploy | grep -qF -- "$PORTA"; then ok "docker-options $PORTA"; else
  dokku docker-options:add amigo-painel deploy "$PORTA" >/dev/null
  mudou "docker-options:add deploy $PORTA"
fi
# A porta fixa no host impede o container novo de subir com o antigo vivo: sem zero-downtime.
if [ "$(rep checks amigo-painel checks-disabled-list)" = _all_ ]; then ok "checks desligados"; else
  dokku checks:disable amigo-painel >/dev/null
  mudou "checks:disable"
fi
cfg amigo-painel PORT=3999 DO_NOT_TRACK=1 OW_DB=/data/ow.db

echo "mudanças: $MUDANCAS"
REMOTO
