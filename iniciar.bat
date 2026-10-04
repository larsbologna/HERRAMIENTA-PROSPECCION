@echo off
chcp 65001 >nul
title Prospeccion - CRM
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Falta Node.js. Descargalo e instalalo desde https://nodejs.org ^(version LTS^) y volve a abrir este archivo.
  echo.
  pause
  exit /b 1
)

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
  echo.
  echo  Tu version de Node.js es muy vieja. Esta herramienta necesita Node.js 22.13 o superior.
  echo  Descarga la version LTS desde https://nodejs.org, instalala y volve a abrir este archivo.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo.
  echo  Primera ejecucion: instalando dependencias ^(puede tardar unos minutos^)...
  echo.
  call npm install || goto :error
  call npx playwright install chromium || goto :error
)

call npm start
goto :eof

:error
echo.
echo  No se pudo completar la instalacion. Revisa tu conexion a internet y volve a intentarlo.
pause
exit /b 1
