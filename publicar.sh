#!/usr/bin/env bash
# Publica o site: carimba uma versão nova nos arquivos (para o celular não usar a cópia antiga)
# e envia para main e gh-pages (GitHub Pages).
set -euo pipefail
cd "$(dirname "$0")"
v=$(date -u +%Y%m%d%H%M)
sed -i -E "s/\?v=[0-9]+/?v=$v/g" index.html admin.html assets/app.js assets/admin.js assets/shared.js assets/client.js
git add -A
git commit -qm "${1:-Publicar versão $v}" || true
git push -q origin main
git push -q origin main:gh-pages
echo "Publicado: versão $v"
