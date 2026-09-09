#!/usr/bin/env bash
# Reconstrói o site e publica a pasta site/ no repositório público casomaster-site (GitHub Pages).
# Uso: ./publicar.sh
set -euo pipefail
cd "$(dirname "$0")"
node validar.mjs >/dev/null
node construir.mjs
DESTINO="$(mktemp -d)"
cp -R site/. "$DESTINO"/ && touch "$DESTINO/.nojekyll"
cd "$DESTINO"
git init -q -b main
git add -A
git commit -q -m "site gerado em $(date '+%Y-%m-%d %H:%M')"
git push -q --force https://github.com/PedroCaldas13/casomaster-site.git main
cd - >/dev/null && rm -rf "$DESTINO"
echo "Publicado: https://pedrocaldas13.github.io/casomaster-site/"
