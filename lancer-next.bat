@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installation des dependances Next.js requise.
  echo Lancez d'abord : npm install
  pause
  exit /b 1
)
npm run dev
