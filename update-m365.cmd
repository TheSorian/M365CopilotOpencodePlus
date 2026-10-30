@echo off
setlocal
rem Trae las novedades de cramt/m365-copilot-proxy (remote "upstream") y las
rem fusiona con los arreglos de OpenCode del fork. Si hay conflicto, para y avisa.
rem Para volver atras tras un merge malo:  git reset --hard pre-update

cd /d "%~dp0"
git fetch upstream --quiet
echo === Commits nuevos en el original (cramt) ===
git log --oneline main..upstream/main
for /f %%c in ('git rev-list --count main..upstream/main') do set BEHIND=%%c

if "%BEHIND%"=="0" (
  echo.
  echo Nada nuevo en el original. No hay nada que fusionar.
  exit /b 0
)

echo.
echo Fusionando %BEHIND% commit^(s^) de upstream/main en main...
git tag -f pre-update >nul
git merge --no-edit upstream/main
if errorlevel 1 (
  echo.
  echo CONFLICTO. Los choques suelen estar en:
  echo   packages\proxy-lib\src\handler.ts
  echo   packages\core\src\tools.ts
  echo   packages\core\src\fenced.ts
  echo Resuelvelos conservando la logica de OpenCode del fork y luego:
  echo   pnpm.cmd install ^&^& pnpm.cmd build ^&^& pnpm.cmd test
  echo Para descartar el merge:  git merge --abort
  exit /b 1
)

echo.
echo Reinstalando y compilando...
call pnpm.cmd install
if errorlevel 1 exit /b 1
call pnpm.cmd build
if errorlevel 1 exit /b 1
call pnpm.cmd test
if errorlevel 1 exit /b 1

echo.
echo Listo. Reinicia el proxy (start-m365.cmd) para usar la version nueva.
