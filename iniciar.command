#!/bin/bash
# Prospección · CRM: doble clic para iniciar (Mac). En Linux: ./iniciar.command
cd "$(dirname "$0")" || exit 1

pause_and_exit() { read -r -p "Presioná Enter para cerrar…"; exit 1; }

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Falta Node.js. Descargalo e instalalo desde https://nodejs.org (versión LTS) y volvé a abrir este archivo."
  echo ""
  pause_and_exit
fi

if ! node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"; then
  echo ""
  echo "  Tu versión de Node.js ($(node -v)) es muy vieja. Esta herramienta necesita Node.js 22.13 o superior."
  echo "  Descargá la versión LTS desde https://nodejs.org, instalala y volvé a abrir este archivo."
  echo ""
  pause_and_exit
fi

if [ ! -d node_modules ]; then
  echo ""
  echo "  Primera ejecución: instalando dependencias (puede tardar unos minutos)…"
  echo ""
  npm install && npx playwright install chromium || {
    echo "  No se pudo completar la instalación. Revisá tu conexión a internet y volvé a intentarlo."
    pause_and_exit
  }
fi

npm start
