@echo off
setlocal
rem Mantiene al dia la "unificacion" (este repo, origin) fusionando las novedades
rem de los dos repos de los que venimos:
rem   bertogim/main   el fork con los arreglos de OpenCode (de donde salimos)
rem   upstream/main   el original de cramt (lo que sigue Bertogim)
rem Si hay conflicto, para y avisa. Para volver atras:  git reset --hard pre-update

cd /d "%~dp0"

echo === Buscando novedades ===
git fetch --all --quiet
if errorlevel 1 (
  echo No se pudo conectar. Revisa la red o los remotos con:  git remote -v
  exit /b 1
)

echo.
echo --- bertogim/main ---
git log --oneline main..bertogim/main
echo --- upstream/main ---
git log --oneline main..upstream/main

for /f %%c in ('git rev-list --count main..bertogim/main main..upstream/main') do set NEW=%%c
if "%NEW%"=="0" (
  echo.
  echo Nada nuevo ni en el fork ni en el original. No hay nada que fusionar.
  exit /b 0
)

git tag -f pre-update >nul

echo.
echo === Fusionando bertogim/main ===
git merge --no-edit bertogim/main
if errorlevel 1 goto conflicto

echo.
echo === Fusionando upstream/main ===
git merge --no-edit upstream/main
if errorlevel 1 goto conflicto

echo.
echo === Comprobando que nuestros parches siguen ahi ===
node scripts\check-ours.mjs
if errorlevel 1 goto deltas

echo.
echo === Reinstalando, compilando y probando ===
call pnpm.cmd install
if errorlevel 1 exit /b 1
call pnpm.cmd build
if errorlevel 1 exit /b 1
call pnpm.cmd test
if errorlevel 1 exit /b 1

echo.
echo === Subiendo a origin (tu repo) ===
git push origin main
if errorlevel 1 echo AVISO: el merge esta hecho pero el push fallo. Cuando puedas:  git push origin main

echo.
echo Listo. Reinicia el proxy (start-m365.cmd) para usar la version nueva.
exit /b 0

:conflicto
echo.
echo CONFLICTO. Los choques suelen estar en:
echo   packages\proxy-lib\src\handler.ts
echo   packages\core\src\tools.ts
echo   packages\core\src\fenced.ts
echo Conserva la logica de OpenCode del fork y luego:
echo   pnpm.cmd install ^&^& pnpm.cmd build ^&^& pnpm.cmd test
echo Para descartar el merge:      git merge --abort
echo Para volver atras del todo:  git reset --hard pre-update
exit /b 1

:deltas
echo.
echo Un merge ha dejado fuera alguno de nuestros parches (lista de arriba).
echo Para volver atras:  git reset --hard pre-update
exit /b 1
