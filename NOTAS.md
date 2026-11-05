# Notas de esta instalación (M365 Copilot como backend de OpenCode)

Repo propio: `TheSorian/M365CopilotOpencodePlus` (remote `origin`, privado). Sale del fork
`Bertogim/m365-copilot-proxy-opencode` (remote `bertogim`) y del original
`cramt/m365-copilot-proxy` (remote `upstream`).

## Arrancar

    start-m365.cmd          (doble clic; deja la ventana abierta)
    G:\local-AI\run_m365_proxy.bat   el que arrancan run_opencode.bat, run_all.bat y la versión LAN

La primera vez abre una ventana de Chromium para el login (contraseña + MFA). Después
los tokens se refrescan solos y esa ventana ya no sale.

Con el proxy corriendo, en OpenCode: `/models` -> `M365 · GPT-6.1 Sol`.

El proxy tiene que estar corriendo antes de usar el modelo. Si lo paras, ese modelo falla.

No mira ni aplica actualizaciones: arranca con lo que ya está compilado. Las
actualizaciones se hacen aparte y a mano con `update-m365.cmd` (ver más abajo).

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
    set M365_FAIL_CLOSED_CONFAB=1            502 si la negativa persiste (opt-in; por defecto 200)

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

`M365_FAIL_CLOSED_CONFAB=1` no cambia lo que hace el proxy, solo qué devuelve cuando,
agotados los reintentos, el modelo sigue contestando "no puedo acceder a los archivos"
sin llamar a ninguna tool. Sin la variable eso llega como texto normal (HTTP 200) y el
agente lo da por respuesta final; con ella llega como error 502 `tool_access_confabulation`
y el harness puede reintentar o cambiar de modelo. Va apagado a propósito: el disparador
es una lista de patrones y un falso positivo convertiría una respuesta legítima
("pásame la ruta primero") en error.

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
original de cramt (el protocolo). Cada uno entra por su puerta, y **`main` no se fusiona
nunca a ciegas**: primero se prueba en una rama temporal y solo avanza si sale verde.

    update-m365.cmd

Abre un menú:

    1 - Actualizar desde cramt (upstream)   valida en rama temporal; main solo si está verde
    2 - Revisar Bertogim                    rama aparte; main no se toca
    3 - Ver que hay nuevo                   solo lectura
    4 - Salir

También vale como argumento: `update-m365.cmd 1`. La lógica vive en
`scripts\update-upstream.ps1` y `scripts\review-bertogim.ps1` (PowerShell y no batch: así se
comprueba el código de salida de git y de pnpm paso a paso, y se puede probar).

### 1. Actualizar desde cramt

`update-upstream.ps1` hace:

    árbol limpio -> main al día -> rama update-upstream-AAAA-MM-DD
    -> merge upstream/main -> check-ours -> pnpm install -> pnpm test
    -> verde: merge --ff-only a main, push, y se borra la rama
    -> rojo:  se aborta el merge, se borra la rama, y main no se ha movido

Si hay cambios sin commitear no empieza: o los guardas (`git add -A; git commit`) o los
apartas (`git stash -u`). Si el merge trae conflicto, para, lista los ficheros y se limpia
solo; los choques suelen ser `handler.ts`, `tools.ts` y `fenced.ts`, y la regla es conservar
tu lado (OpenCode + patrones en castellano).

Opciones útiles:

    .\scripts\update-upstream.ps1 -NoPush        todo en local, sin subir
    .\scripts\update-upstream.ps1 -KeepBranch    si falla, deja la rama para mirarla

No crea tags: los hitos se etiquetan a mano, uno por versión buena:

    git tag stable-2026-11-20 && git push origin stable-2026-11-20

### 2. Revisar Bertogim

`review-bertogim.ps1` fusiona `bertogim/main` en `review-bertogim-AAAA-MM-DD`, pasa
`check-ours` y la suite, y **nunca toca `main`**. Si sale verde deja la rama y te dice cómo
adoptarla; si sale roja (o hay conflicto) la borra y no se ha traído nada. `-Keep` la
conserva para mirar el fallo.

Es la puerta correcta para Bertogim: el 2026-11-05 su `main` llevaba 12 commits por delante
con la suite en rojo (reescritura del system prompt en `packages/prompts/`, sin bloque
`<tools>`), así que fusionarlo a mano solo mete fallos.

Los remotos:

    origin      tu repo (TheSorian/M365CopilotOpencodePlus) — aquí se sube
    bertogim    el fork del que salimos (arreglos de OpenCode)
    upstream    el original de cramt (lo que sigue Bertogim)
    local       tu clon de cramt en G:\local-AI\m365-copilot-proxy (si existe)

De `origin` no se trae nada: es solo destino. Las novedades entran por `bertogim` y
`upstream`, y como `origin` es el remoto por defecto, `git push` a secas ya sube a tu repo.

## Por que no se pierden nuestros cambios

- `NOTAS.md`, `start-m365.cmd`, `update-m365.cmd` y `scripts\update-upstream.ps1` /
  `scripts\review-bertogim.ps1` no existen en ninguno de los dos repos de origen: un merge no
  puede borrarlos.
- En los ficheros compartidos (`handler.ts`, `tools.ts`, `fenced.ts`...) git fusiona línea a
  línea: o aplica las dos cosas, o para con un conflicto. Nunca descarta en silencio un
  trozo que solo hemos tocado nosotros.
- Todo queda en la historia: el commit de merge lleva el anterior como padre, y además se
  sube a `origin`. Deshacer una actualización es borrar la rama temporal (lo hace el script
  solo) o, si ya se subió, `git revert -m 1 <commit-de-merge>`.
- Lo que sí puede pasar es que un merge aplique limpio y deje un parche muerto (una función
  renombrada, una rama que ya no se usa). Para eso está `scripts/check-ours.mjs`:
  `update-upstream.ps1` lo ejecuta dentro de la rama temporal y no promociona si falta
  alguno. A mano:

      node scripts\check-ours.mjs

Si algún día quieres el original literal (nada del fork), probado que aplica limpio:

    git checkout -b original upstream/main
    git cherry-pick 1ff41a7     # las frases en castellano de deteccion de "me rindo"
    pnpm.cmd install && pnpm.cmd build

## Recordatorios

- Cuenta de empresa/centro educativo; las personales no valen.
- En PowerShell usa `pnpm.cmd` (tu ExecutionPolicy bloquea `pnpm.ps1`).
- API no documentada: puede romperse sin aviso. El uso es responsabilidad de tu cuenta.
