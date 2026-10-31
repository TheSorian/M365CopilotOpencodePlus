# Notas de esta instalación (M365 Copilot como backend de OpenCode)

Repo propio: `TheSorian/M365CopilotOpencodePlus` (remote `origin`, privado). Sale del fork
`Bertogim/m365-copilot-proxy-opencode` (remote `bertogim`) y del original
`cramt/m365-copilot-proxy` (remote `upstream`).

## Arrancar

    start-m365.cmd          (doble clic; deja la ventana abierta)

La primera vez abre una ventana de Chromium para el login (contraseña + MFA). Después
los tokens se refrescan solos y esa ventana ya no sale.

Con el proxy corriendo, en OpenCode: `/models` -> `M365 · GPT-6.1 Sol`.

El proxy tiene que estar corriendo antes de usar el modelo. Si lo paras, ese modelo falla.

Antes de arrancar mira si hay novedades en `bertogim` y `upstream` (un `fetch`, ~2 s). Si
las hay, las lista y pregunta: **S** actualiza y luego arranca, **N** arranca con lo que ya
está compilado. Si no contestas en 15 s, arranca sin tocar nada. Nunca fusiona por su
cuenta. Para que ni mire: `set M365_NO_UPDATE_CHECK=1`.

## Los ajustes que importan

Todos se ponen en `start-m365.cmd`, antes de la línea `node ...`:

    set M365_ENABLE_INTERACTIVE_APPROVAL=1   login a mano la primera vez
    set M365_LOGIN_UA=...                    UA de Chrome en Windows (por defecto viene uno de Linux)
    set M365_LOGIN_LOCALE=es-ES              por defecto en-GB
    set M365_LOGIN_TIMEZONE=Europe/Madrid    por defecto Europe/Copenhagen
    set M365_DEBUG=1                         log en ~/.config/opencode-m365/debug.log
    set M365_AVOID_THROTTLING=1              frena antes de agotar el cupo
    set M365_OPENCODE_TOOLS=...              allowlist propia: 10 tools, con skill y execute
    set M365_IMAGE_DIR=%USERPROFILE%\Pictures\m365   imágenes generadas (por defecto ~/Pictures)

Lo del UA/locale/zona no es cosmético: el login abre un Chromium visible y, con los
valores por defecto, la huella dice "Linux, en-GB, Copenhague" mientras el navegador
corre en un Windows español (navigator.platform = Win32). El propio código avisa de
que esa incoherencia es detectable. Si no estás en España, cambia la zona.

Recorte de tools: ACTIVADO con allowlist propia. De las 16 tools que manda OpenCode se
ofrecen 10: glob, grep, patch, question, read, shell, skill, webfetch, websearch, execute.
Se caen las cinco `openchamber_*` y `subagent`.
Medido en el request real: 46.578 chars de prompt (allowlist del fork con 8 = 45.324;
sin recorte con 16 = 51.516).
Para desactivar el recorte del todo: `set M365_OPENCODE_TRIM=0`.

## Cuando algo va mal, en este orden

1. Respuesta vacía o "no puedo ejecutar comandos" -> borrar la línea `M365_OPENCODE_TOOLS`
   (allowlist del fork, 8 tools) o poner `M365_OPENCODE_TRIM=0` (sin recorte). Reiniciar proxy.
2. Sigue igual -> cambiar de modelo: `gpt-6-sol` o `claude-sonnet` (este último tool-callea bien).
3. A media sesión dice que perdió las tools -> `/export`, chat nuevo, y mandar `RESTORECONTEXT`
   como mensaje (o pegar el export y pedir "lee las últimas 700 líneas y continúa").
4. Error 429 / `m365_throttled` -> cupo agotado (~100 turnos, +1,6/min). Esperar; no reintentar en bucle.
5. El proxy no arranca -> `pnpm.cmd install && pnpm.cmd build` y mirar `~/.config/opencode-m365/debug.log`.

## Actualizar (viene de dos sitios)

Este repo es la unificación de dos: el fork de Bertogim (los arreglos para OpenCode) y el
original de cramt (el protocolo). `update-m365.cmd` fusiona los dos, en ese orden, y
después reinstala, compila, pasa los tests y sube el resultado a `origin`:

    update-m365.cmd

Si hay conflicto, para y dice dónde mirar:

    git merge --abort              descartar el merge
    git reset --hard pre-update    volver a como estaba antes de fusionar

Los remotos:

    origin      tu repo (TheSorian/M365CopilotOpencodePlus) — aquí se sube
    bertogim    el fork del que salimos (arreglos de OpenCode)
    upstream    el original de cramt (lo que sigue Bertogim)

De `origin` no se trae nada: es solo destino. Las novedades entran por `bertogim` y
`upstream`, y como `origin` es el remoto por defecto, `git push` a secas ya sube a tu repo.

## Por que no se pierden nuestros cambios

- `NOTAS.md`, `start-m365.cmd` y `update-m365.cmd` no existen en ninguno de los dos repos
  de origen: un merge no puede borrarlos.
- En los ficheros compartidos (`handler.ts`, `tools.ts`, `fenced.ts`...) git fusiona línea a
  línea: o aplica las dos cosas, o para con un conflicto. Nunca descarta en silencio un
  trozo que solo hemos tocado nosotros.
- Todo queda en la historia: el commit de merge lleva el anterior como padre, y además se
  sube a `origin`. Deshacer es `git reset --hard pre-update`.
- Lo que sí puede pasar es que un merge aplique limpio y deje un parche muerto (una función
  renombrada, una rama que ya no se usa). Para eso está `scripts/check-ours.mjs`:
  `update-m365.cmd` lo ejecuta tras fusionar y para si falta alguno. A mano:

      node scripts\check-ours.mjs

Si algún día quieres el original literal (nada del fork), probado que aplica limpio:

    git checkout -b original upstream/main
    git cherry-pick 1ff41a7     # las frases en castellano de deteccion de "me rindo"
    pnpm.cmd install && pnpm.cmd build

## Recordatorios

- Cuenta de empresa/centro educativo; las personales no valen.
- En PowerShell usa `pnpm.cmd` (tu ExecutionPolicy bloquea `pnpm.ps1`).
- API no documentada: puede romperse sin aviso. El uso es responsabilidad de tu cuenta.
