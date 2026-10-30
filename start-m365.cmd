@echo off
setlocal
rem Arranca el proxy M365 Copilot en el puerto indicado (por defecto 4141).
rem Primer arranque: abre un navegador para iniciar sesion a mano (MFA push/FIDO2/Okta valen).
rem Despues de ese primer login, los tokens se refrescan solos desde la cache MSAL.

set M365_ENABLE_INTERACTIVE_APPROVAL=1
rem El login usa por defecto UA de Linux, locale en-GB y zona Europe/Copenhagen.
rem En un PC Windows eso es una huella incoherente (navigator.platform dice Win32):
set "M365_LOGIN_UA=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
set "M365_LOGIN_LOCALE=es-ES"
set "M365_LOGIN_TIMEZONE=Europe/Madrid"
set M365_DEBUG=1
rem Frena antes de agotar el cupo de turnos (~100, +1.6/min) y evita el bloqueo de ~1h:
set M365_AVOID_THROTTLING=1
rem Recorte de tools ACTIVADO: 16 -> 10. Se conservan `skill` y `execute` a proposito.
rem Para volver al allowlist del fork (8 tools, sin skill ni execute), borra la linea siguiente.
rem Para desactivar el recorte del todo, anade: set M365_OPENCODE_TRIM=0
set M365_OPENCODE_TOOLS=shell,read,edit,write,grep,glob,webfetch,websearch,question,patch,apply_patch,skill,execute

cd /d "%~dp0"

rem El debug.log crece sin limite (~150 KB por turno). Al pasar de 100 MB lo
rem renombramos a debug-old.log: el presupuesto de turnos lo sigue leyendo (su
rem nombre encaja en debug*.log) y se sobrescribe en la siguiente rotacion.
if exist "%USERPROFILE%\.config\opencode-m365\debug.log" (
  for %%F in ("%USERPROFILE%\.config\opencode-m365\debug.log") do (
    if %%~zF GTR 104857600 move /y "%%~dpnF.log" "%%~dpnF-old.log" >nul
  )
)

if "%~1"=="" (
  node packages\proxy\bin\m365-proxy.mjs 4141
) else (
  node packages\proxy\bin\m365-proxy.mjs %1
)
