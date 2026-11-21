#!/usr/bin/env bash
# Deploy manual do front (app/) no Worker de arquivos estáticos `amigo-secreto` (wrangler.jsonc).
# O caminho normal é o Workers Builds: cada push na main builda e publica sozinho. Este script é
# para deploy local (ex.: Workers Builds fora do ar). Usa o login OAuth do wrangler.
set -euo pipefail
raiz="$(cd "$(dirname "$0")/.." && pwd)"
(cd "$raiz/app" && bun --bun vite build)
(cd "$raiz" && bunx --bun wrangler@4 deploy)
