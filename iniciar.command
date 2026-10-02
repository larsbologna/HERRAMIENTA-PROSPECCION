#!/bin/bash
# Herramienta de prospección: doble clic para iniciar (Mac). En Linux: ./iniciar.command
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Falta Node.js. Descargalo e instalalo desde https://nodejs.org (versión LTS) y volvé a abrir este archivo."
  echo ""
  read -r -p "Presioná Enter para cerrar…"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo ""
  echo "  Primera ejecución: instalando dependencias (puede tardar unos minutos)…"
  echo ""
  npm install && npx playwright install chromium || {
    echo "  No se pudo completar la instalación. Revisá tu conexión a internet y volvé a intentarlo."
    read -r -p "Presioná Enter para cerrar…"
    exit 1
  }
fi

npm start
