#!/usr/bin/env bash
# Provisiona na VPS os apps Dokku `amigo-worker` e `amigo-painel` (volume `amigo-workflows`) e
# `amigo-mcp` (volume `amigo-mcp-data`, domínio amigo-mcp.app.tpou.gy com Let's Encrypt).
# Idempotente: cada passo confere o estado antes de mudar; a última linha diz quantas mudanças houve.
# Segredos (app_id/admin_token do Instant de produção) são lidos na própria VPS de
# /root/instant-apps/amigo-secreto.env e nunca passam por esta máquina nem pela saída.
# O SORTEIO_SEGREDO (seed do sorteio, só no amigo-worker) e as chaves do MCP
# (MCP_ENCRYPTION_KEY/MCP_JWT_KEY) são gerados na VPS uma única vez: gerar de novo mudaria a seed ou
# invalidaria as sessões OAuth já emitidas. As credenciais do Google começam como `pendente` e só
# são gravadas se ainda não existirem (o valor real, configurado depois, nunca é sobrescrito).
set -euo pipefail

HOST=vps-mercurio

ssh "$HOST" 'bash -s' <<'REMOTO'
set -euo pipefail

VOL=amigo-workflows
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

# volume <nome>: cria o storage do Dokku (dono = usuário `bun`).
volume() {
  local vol=$1 dir=/var/lib/dokku/data/storage/$1
  echo "== volume $vol"
  if dokku storage:info "$vol" >/dev/null 2>&1; then ok "storage $vol"; else
    dokku storage:create "$vol" >/dev/null
    mudou "storage:create $vol"
  fi
  if [ "$(stat -c %u:%g "$dir")" = "$UID_BUN" ]; then ok "dono $UID_BUN"; else
    chown "$UID_BUN" "$dir"
    mudou "chown $UID_BUN $dir"
  fi
}

# app_base <app> <dir> <volume>: app com build por Dockerfile (contexto = repositório inteiro)
# em <dir>/Dockerfile e o volume montado em /data.
app_base() {
  local app=$1 dir=$2 vol=$3
  if dokku apps:exists "$app" >/dev/null 2>&1; then ok "app"; else
    dokku apps:create "$app" >/dev/null
    mudou "apps:create"
  fi
  if [ "$(rep builder "$app" builder-selected)" = dockerfile ]; then ok "builder dockerfile"; else
    dokku builder:set "$app" selected dockerfile >/dev/null
    mudou "builder:set selected dockerfile"
  fi
  if [ "$(rep builder-dockerfile "$app" builder-dockerfile-dockerfile-path)" = "$dir/Dockerfile" ]; then
    ok "dockerfile-path $dir/Dockerfile"
  else
    dokku builder-dockerfile:set "$app" dockerfile-path "$dir/Dockerfile" >/dev/null
    mudou "dockerfile-path $dir/Dockerfile"
  fi
  if dokku storage:list "$app" 2>/dev/null | grep -q "/var/lib/dokku/data/storage/$vol:/data"; then
    ok "volume $vol em /data"
  else
    dokku storage:mount "$app" "$vol" --container-dir /data >/dev/null
    mudou "storage:mount $vol /data"
  fi
}

volume "$VOL"
for APP in amigo-worker amigo-painel; do
  echo "== $APP"
  app_base "$APP" "${APP#amigo-}" "$VOL"
  if [ "$(rep proxy "$APP" proxy-enabled)" = false ]; then ok "proxy desligado"; else
    dokku proxy:disable "$APP" >/dev/null
    mudou "proxy:disable"
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
# Depois do deploy o `ps:scale` omite tipos com 0; ausente conta como 0.
ESCALA=$(dokku ps:scale amigo-worker 2>/dev/null | awk '
  $1 ~ /^(web|worker):$/ { sub(":", "", $1); n[$1] = $2 }
  END { printf "web=%d worker=%d", n["web"], n["worker"] }')
if [ "$ESCALA" = "web=0 worker=1" ]; then ok "escala web=0 worker=1"; else
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
# Segredo da seed do sorteio (HMAC): só no amigo-worker, gerado aqui uma única vez e nunca
# impresso. Regenerar mudaria a seed de sorteios em andamento; nunca sobrescrever.
if [ -n "$(dokku config:get amigo-worker SORTEIO_SEGREDO 2>/dev/null || true)" ]; then ok "SORTEIO_SEGREDO definido"; else
  dokku config:set --no-restart amigo-worker "SORTEIO_SEGREDO=$(openssl rand -hex 32)" >/dev/null
  mudou "amigo-worker config:set SORTEIO_SEGREDO (novo)"
fi

echo "== amigo-painel (127.0.0.1:3999, só por túnel)"
PORTA="-p 127.0.0.1:3999:3999"
if rep docker-options amigo-painel docker-options-deploy | grep -qF -- "$PORTA"; then ok "docker-options $PORTA"; else
  dokku docker-options:add amigo-painel deploy "$PORTA" >/dev/null
  mudou "docker-options:add deploy $PORTA"
fi
# O Dokku injeta PORT = porta do container no mapa de portas (detectado: 5000), por cima do
# config:set PORT. Fixar o mapa em 3999 faz o PORT injetado ser 3999. Sem proxy, nada é publicado
# por causa do mapa; a única publicação é o -p 127.0.0.1 acima.
if [ "$(rep ports amigo-painel ports-map)" = http:3999:3999 ]; then ok "ports http:3999:3999"; else
  dokku ports:set amigo-painel http:3999:3999 >/dev/null
  mudou "ports:set http:3999:3999"
fi
# A porta fixa no host impede o container novo de subir com o antigo vivo: sem zero-downtime.
if [ "$(rep checks amigo-painel checks-disabled-list)" = _all_ ]; then ok "checks desligados"; else
  dokku checks:disable amigo-painel >/dev/null
  mudou "checks:disable"
fi
cfg amigo-painel PORT=3999 DO_NOT_TRACK=1 OW_DB=/data/ow.db

MCP=amigo-mcp
MCP_DOMINIO=amigo-mcp.app.tpou.gy
volume amigo-mcp-data
echo "== $MCP (https://$MCP_DOMINIO, porta 8080 no container)"
app_base "$MCP" mcp amigo-mcp-data
if [ "$(rep ps "$MCP" ps-procfile-path)" = mcp/Procfile ]; then ok "procfile-path"; else
  dokku ps:set "$MCP" procfile-path mcp/Procfile >/dev/null
  mudou "ps:set procfile-path mcp/Procfile"
fi
if [ "$(rep domains "$MCP" domains-app-vhosts)" = "$MCP_DOMINIO" ]; then ok "domínio $MCP_DOMINIO"; else
  dokku domains:set "$MCP" "$MCP_DOMINIO" >/dev/null
  mudou "domains:set $MCP_DOMINIO"
fi
# O Dokku injeta PORT = porta do container no mapa (8080), que é onde o servidor ouve.
MAPA=$(rep ports "$MCP" ports-map | tr ' ' '\n' | sort | xargs)
if [ "$MAPA" = "http:80:8080 https:443:8080" ]; then ok "ports $MAPA"; else
  dokku ports:set "$MCP" http:80:8080 https:443:8080 >/dev/null
  mudou "ports:set http:80:8080 https:443:8080 (antes: ${MAPA:-vazio})"
fi
cfg "$MCP" INSTANT_API_URI=https://instant.tpou.gy DO_NOT_TRACK=1 MCP_TOKENS_DIR=/data/tokens
app_id=$(grep -m1 '^app_id=' "$SEGREDOS" | cut -d= -f2-)
admin_token=$(grep -m1 '^admin_token=' "$SEGREDOS" | cut -d= -f2-)
[ -n "$app_id" ] && [ -n "$admin_token" ] || { echo "faltam app_id/admin_token em $SEGREDOS" >&2; exit 1; }
cfg "$MCP" INSTANT_APP_ID="$app_id" INSTANT_ADMIN_TOKEN="$admin_token"
unset app_id admin_token
# Só cria o que falta; nunca regrava (chaves geradas uma vez; Google configurado depois à mão).
for K in MCP_ENCRYPTION_KEY MCP_JWT_KEY GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET; do
  if [ -n "$(dokku config:get "$MCP" "$K" 2>/dev/null || true)" ]; then ok "$K definido"; else
    case $K in
      MCP_*) dokku config:set --no-restart "$MCP" "$K=$(openssl rand -hex 32)" >/dev/null ;;
      *) dokku config:set --no-restart "$MCP" "$K=pendente" >/dev/null ;;
    esac
    mudou "$MCP config:set $K (novo)"
  fi
done
# Let's Encrypt precisa do app no ar (desafio HTTP pelo nginx): na 1ª vez, rodar de novo após o deploy.
if [ "$(rep letsencrypt "$MCP" letsencrypt-active)" = true ]; then ok "letsencrypt ativo"; elif
  [ "$(rep ps "$MCP" deployed)" = true ]; then
  dokku letsencrypt:enable "$MCP" >/dev/null
  mudou "letsencrypt:enable"
else
  echo "  pendente: letsencrypt:enable depois do 1º deploy (infra/deploy.sh $MCP; rode este script de novo)"
fi

echo "mudanças: $MUDANCAS"
REMOTO
