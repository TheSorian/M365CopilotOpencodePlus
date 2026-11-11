@echo off
setlocal
rem Menu de mantenimiento del repo.
rem
rem La logica vive en scripts\update-upstream.ps1 y scripts\review-bertogim.ps1:
rem en batch los errores de git son ilegibles y no se puede comprobar nada paso a
rem paso. La regla es que main no se mueve hasta que la actualizacion esta
rem validada en una rama temporal (check-ours + pnpm test).
rem
rem   1  trae cramt (upstream) y valida; main solo avanza si todo esta verde
rem   2  prueba Bertogim en una rama aparte; main nunca se toca
rem   3  solo enseña que hay nuevo
rem
rem Tambien vale pasarlo como argumento:  update-m365.cmd 1

cd /d "%~dp0"

set "OPCION=%~1"
if defined OPCION goto ejecutar

echo.
echo   Mantenimiento de M365CopilotOpencodePlus
echo.
echo   1 - Actualizar desde cramt (upstream)   valida en rama temporal
echo   2 - Revisar Bertogim                    rama aparte, no toca main
echo   3 - Ver que hay nuevo                   solo lectura
echo   4 - Actualizar del repo propio (origin)  lo mismo que hace el arranque
echo   5 - Salir
echo.
set /p "OPCION=Opcion [1-5]: "
if not defined OPCION exit /b 2
goto ejecutar

:ejecutar
if "%OPCION%"=="1" goto upstream
if "%OPCION%"=="2" goto bertogim
if "%OPCION%"=="3" goto estado
if "%OPCION%"=="4" goto propio
if "%OPCION%"=="5" exit /b 0
echo.
echo Opcion no valida: "%OPCION%"
exit /b 2

:upstream
call :lanzar "scripts\update-upstream.ps1"
goto fin

:bertogim
call :lanzar "scripts\review-bertogim.ps1"
goto fin

:propio
rem Fast-forward de origin/main + install/build si hace falta. No fusiona nada:
rem las otras dos puertas siguen siendo 1 y 2.
call :lanzar "scripts\self-update.ps1"
goto fin

:estado
echo.
echo === Trayendo referencias (solo lectura) ===
rem Solo los tres remotos vivos: 'local' apunta a un clon que puede no existir.
git fetch --prune --quiet origin
git fetch --prune --quiet upstream
git fetch --prune --quiet bertogim
echo.
echo --- origin/main (nuestro repo; es lo que aplica el arranque) ---
git log --oneline --no-decorate main..origin/main
echo.
echo --- upstream/main (cramt) ---
git log --oneline main..upstream/main
echo.
echo --- bertogim/main (fork de OpenCode) ---
git log --oneline main..bertogim/main
echo.
echo (Si no sale nada debajo de cada cabecera, no hay novedades.)
if not defined M365_NO_PAUSE pause
exit /b 0

:lanzar
rem pnpm.cmd y no pnpm.ps1: la ExecutionPolicy bloquea el segundo.
set "SCRIPT=%~1"
set "PS=powershell"
where pwsh >nul 2>nul
if not errorlevel 1 set "PS=pwsh"
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
exit /b %errorlevel%

:fin
if errorlevel 1 (
  echo.
  echo No se ha aplicado nada: main sigue como estaba. Lee los mensajes de arriba.
  if not defined M365_NO_PAUSE pause
  exit /b 1
)
echo.
echo Hecho.
if not defined M365_NO_PAUSE pause
exit /b 0
