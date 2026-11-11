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

Al arrancar se pone al día **solo**, pero solo del repo propio: trae `origin/main`
por fast-forward, hace `pnpm install` si cambia el lockfile y `pnpm build` si el
commit aún no está compilado. Por eso, en otro ordenador, un `git clone` normal y
doble clic basta: la primera vez instala, compila y arranca.

No toca nada si el árbol tiene cambios sin commitear, si estás en otra rama, si
`main` tiene commits locales sin subir o si no hay red: avisa y arranca con lo que
ya está compilado. Si el commit nuevo no compila, vuelve al anterior y arranca con
ese. Para saltarse la comprobación en un arranque concreto:

    set M365_SKIP_UPDATE=1

Las novedades de cramt y de Bertogim **no** entran por aquí: siguen siendo
`update-m365.cmd`, con rama temporal y validación (ver más abajo).
## Los ajustes que importan

Todos se ponen en `start-m365.cmd`, antes de la línea `node ...`:

    set M365_ENABLE_INTERACTIVE_APPROVAL=1   login a mano la primera vez
    set M365_LOGIN_UA=...                    UA de Chrome en Windows (por defecto viene uno de Linux)
    set M365_LOGIN_LOCALE=es-ES              por defecto en-GB
    set M365_LOGIN_TIMEZONE=Europe/Madrid    por defecto Europe/Copenhagen
    set M365_DEBUG=1                         log en ~/.config/opencode-m365/debug.log
    set M365_AVOID_THROTTLING=1              frena antes de agotar el cupo
    set M365_OPENCODE_TOOLS=...              allowlist propia; admite prefijos terminados en *
    set M365_IMAGE_DIR=%USERPROFILE%\Pictures\m365   imágenes generadas (por defecto ~/Pictures)
    set M365_FAIL_CLOSED_CONFAB=1            502 si la negativa persiste (opt-in; por defecto 200)
    set M365_SKIP_UPDATE=1                   arranca sin buscar actualizaciones del repo propio

Lo del UA/locale/zona no es cosmético: el login abre un Chromium visible y, con los
valores por defecto, la huella dice "Linux, en-GB, Copenhague" mientras el navegador
corre en un Windows español (navigator.platform = Win32). El propio código avisa de
que esa incoherencia es detectable. Si no estás en España, cambia la zona.

Recorte de tools: ACTIVADO con allowlist propia. De las tools que manda OpenCode se
ofrecen las de código y consola (glob, grep, patch, question, read, shell, write, edit,
apply_patch, skill, execute, webfetch, websearch) más las de Office. Se caen las
`openchamber_*`, `subagent` y cualquier otro MCP que instales.
Medido en el request real: 46.578 chars de prompt (allowlist del fork con 8 = 45.324;
sin recorte con 16 = 51.516).

Las de Office van en la lista a propósito, y son lo que arregló que `officeMCP` "fallara":
`officecli` y `OfficeMCP.*`. Una entrada terminada en `*` casa por prefijo, así que
`OfficeMCP.*` cubre las 14 tools del MCP sin fijarlas una a una (su lista cambia con la
versión). Si el toolset tiene que quedar más corto, deja solo `OfficeMCP.RunPython`: es la
que hace el trabajo; las demás son Launch/Quit/AvailableApps y utilidades.

Con `M365_DEBUG=1` el log dice en cada request qué se ofreció, sin adivinar:
`OpenCode toolset: 15/41 kept — shell, read, …, OfficeMCP.RunPython`.

Para desactivar el recorte del todo: `set M365_OPENCODE_TRIM=0`.

`M365_FAIL_CLOSED_CONFAB=1` no cambia lo que hace el proxy, solo qué devuelve cuando,
agotados los reintentos, el modelo sigue contestando "no puedo acceder a los archivos"
sin llamar a ninguna tool. Sin la variable eso llega como texto normal (HTTP 200) y el
agente lo da por respuesta final; con ella llega como error 502 `tool_access_confabulation`
y el harness puede reintentar o cambiar de modelo. Va apagado a propósito: el disparador
es una lista de patrones y un falso positivo convertiría una respuesta legítima
("pásame la ruta primero") en error.

## Cuando algo va mal, en este orden

1. Respuesta vacía, "no puedo ejecutar comandos" o "no tengo disponible la herramienta de
   ejecución" -> mirar en el log qué se ofreció (`OpenCode toolset: ...`). Si falta la tool
   que hacía falta, añádela a `M365_OPENCODE_TOOLS` (con `Nombre.*` entra todo un MCP), o
   borra la línea, o pon `M365_OPENCODE_TRIM=0`. Reiniciar proxy.
2. Sigue igual -> cambiar de modelo: `gpt-6-sol` o `claude-sonnet` (este último tool-callea bien).
3. A media sesión dice que perdió las tools -> `/export`, chat nuevo, y mandar `RESTORECONTEXT`
   como mensaje (o pegar el export y pedir "lee las últimas 700 líneas y continúa").
4. Error 429 / `m365_throttled` -> cupo agotado (~100 turnos, +1,6/min). Esperar; no reintentar en bucle.
5. El proxy no arranca -> `pnpm.cmd install && pnpm.cmd build` y mirar `~/.config/opencode-m365/debug.log`.

## Actualizar (tres puertas)

Este repo es la unificación de dos: el fork de Bertogim (los arreglos para OpenCode) y el
original de cramt (el protocolo). Cada uno entra por su puerta, y **`main` no se fusiona
nunca a ciegas**: primero se prueba en una rama temporal y solo avanza si sale verde.

El arranque del proxy ya cubre la puerta del repo propio (`origin`, opción 4). Las otras
dos, la de cramt y la de Bertogim, se abren siempre a mano con `update-m365.cmd`.

    update-m365.cmd

Abre un menú:

    1 - Actualizar desde cramt (upstream)   valida en rama temporal; main solo si está verde
    2 - Revisar Bertogim                    rama aparte; main no se toca
    3 - Ver que hay nuevo                   solo lectura (las tres puertas)
    4 - Actualizar del repo propio (origin) igual que hace el arranque
    5 - Salir

También vale como argumento: `update-m365.cmd 1`. La lógica vive en
`scripts\update-upstream.ps1`, `scripts\review-bertogim.ps1` y `scripts\self-update.ps1`
(PowerShell y no batch: así se comprueba el código de salida de git y de pnpm paso a paso,
y se puede probar).

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

Su system prompt propio (`packages/prompts/opencode-system.md`) no se trae, y no es un olvido:
sustituye el prompt del harness entero, mientras que aquí se pasa intacto y solo se recorta el
toolset. Ya se probó reescribirlo y se revirtió (2026-10-29). El motivo y el experimento que
haría falta para reabrirlo están en `docs/hypotheses.md`, "Re-checked 2026-11-11".

Lo que de Bertogim sí se ha aprovechado se ha portado a mano, sin traer `packages/prompts/`:
su `d521e68` (M365 repite la misma respuesta bajo otro `messageId`; el compositor la pliega en
vez de duplicarla) y su `4b0da8d` (la respuesta doble llega a veces dentro de un solo mensaje:
el handler colapsa el repetido exacto). Los dos con test unitario. El resto de su `main` es su
propio system prompt y sus logs, que aquí no aplican.
Es la puerta correcta para Bertogim: el 2026-11-05 su `main` llevaba 12 commits por delante
con la suite en rojo (reescritura del system prompt en `packages/prompts/`, sin bloque
`<tools>`), así que fusionarlo a mano solo mete fallos.

Los remotos:

    origin      tu repo (TheSorian/M365CopilotOpencodePlus) — aquí se sube
    bertogim    el fork del que salimos (arreglos de OpenCode)
    upstream    el original de cramt (lo que sigue Bertogim)
    local       tu clon de cramt en G:\local-AI\m365-copilot-proxy (si existe)

De `origin` solo se trae lo que publican tus otras máquinas: lo hace el arranque (o
`update-m365.cmd 4`) por fast-forward. Las novedades de fondo entran por `bertogim` y
`upstream`, y como `origin` es el remoto por defecto, `git push` a secas ya sube a tu repo.

### 3. Ver que hay nuevo

Solo lectura: `git fetch --all` y enseña los commits que traen `origin`, `upstream` y
`bertogim` por delante de `main`. No aplica nada.

### 4. Repo propio (origin)

Es lo mismo que hace el arranque, para lanzarlo a mano sin abrir el proxy:

    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\self-update.ps1
    .\scripts\self-update.ps1 -Check     # solo ver si hay algo nuevo

Solo hace fast-forward de `main` desde `origin/main`, y solo si el árbol está limpio (los
ficheros sin seguimiento no cuentan: si el pull choca con uno, git aborta y se avisa).
Después instala dependencias si cambió `pnpm-lock.yaml` o no hay `node_modules`, y compila
si el HEAD no coincide con el sello `.git/m365-build-commit`. Ese sello es lo que deja que un
clon nuevo se instale y compile solo la primera vez, y que los arranques siguientes no
recompilen por gusto. Si desde el último build solo han cambiado docs, scripts o los `.cmd`
del arranque (nada de `packages/` ni los ficheros de build de la raíz), el sello avanza sin
recompilar.

Si el commit nuevo no compila, el script vuelve al anterior (`git reset --hard` del commit
de partida; el árbol estaba limpio, así que no se pierde nada) y arranca con la versión que
ya funcionaba. Si no hay red, avisa y sigue con lo compilado. Códigos de salida: `0` hay
proxy que arrancar, `1` no lo hay (y el lanzador para en vez de arrancar a medias).

## La lista de modelos que ves en OpenCode

No la pone el proxy: `/v1/models` anuncia siempre las 34 claves de `MODEL_TONES`,
porque el proxy no sabe qué cuenta tiene delante. La lista que sale en OpenCode es
la del `models` del provider `m365` en `~/.config/opencode/opencode.jsonc`, y por eso
cada equipo tiene la suya. Eso sobrevive a las actualizaciones; tocar `packages/`
para filtrar, no: el arranque hace `git pull` y `pnpm build`, así que el parche se
pierde o bloquea la actualización.

Para saber qué modelos sirve de verdad una cuenta hacen falta turnos: el catálogo
del servidor todavía no se ha encontrado (`docs/hypotheses.md`, "Nov 11 2026 - is
there a server-side model catalogue?"). Mientras tanto, ante la duda, prueba el
modelo una vez: si la cuenta no lo tiene, el proxy ya responde 502 diciéndolo.

## Por que no se pierden nuestros cambios

- `NOTAS.md`, `start-m365.cmd`, `update-m365.cmd` y `scripts\update-upstream.ps1` /
  `scripts\review-bertogim.ps1` / `scripts\self-update.ps1` no existen en ninguno de los dos
  repos de origen: un merge no puede borrarlos.
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

# Configuración global de OpenCode (MCPs, skills, plugins)

A partir del 2026-11-11 todo lo que debe estar disponible **en cualquier carpeta**
vive en la configuración global, no en `G:\local-AI\opencode.json`.

| Qué | Dónde | Notas |
|---|---|---|
| MCPs (`web-search`, `playwright`, `cua-driver`, `OfficeMCP`) | `~/.config/opencode/opencode.jsonc` → `mcp.servers` | Forma V2: `type`, `command`, y `disabled` si hay que apagarlo. La forma antigua (`mcp.<nombre>` con `enabled`) el servidor sí la ejecuta —las tools de OfficeMCP respondían dentro de `G:\local-AI`—, pero `opencode mcp list` no la veía ("No MCP servers configured") y sobre todo no aplicaba fuera de esa carpeta. |
| Skills | `~/.config/opencode/skills/<id>/SKILL.md` | El skill `office` (officecli) estaba solo en `G:\local-AI\.opencode\skills`; ahora también global. El global tiene menos precedencia: el del proyecto sigue ganando si existe. |
| Plugins | `~/.config/opencode/opencode.jsonc` → `plugins` | `@xirothedev/openoffice-p` (el que da `officecli`) ya estaba global. |
| Agentes (`build`, `chat`, `desktop`, `plan`, `web`) | `~/.config/opencode/opencode.jsonc` → `agent` | Antes solo existían dentro de `G:\local-AI`. |
| Modelos y providers | `~/.config/opencode/opencode.jsonc` → `providers` | `G:\local-AI\opencode.json` conserva su propia copia (idéntica salvo nombres de modelo). |

Comprobar sin adivinar:

    opencode mcp list          # ✓ connected por servidor; desde CUALQUIER carpeta

Ojo: la primera ejecución tras abrir una carpeta nueva puede imprimir
"No MCP servers configured" mientras arranca el servicio. Repetirlo a los pocos
segundos; si sale `✓ ... connected`, está bien.

**El recorte del proxy ya no toca ningún MCP.** Cualquier tool que lleve su servidor
en el nombre (`OfficeMCP.RunPython`, `playwright.browser_click`) pasa siempre, aunque
la lista no la mencione: los servidores los activas tú en OpenCode. Si algún día
quieres que no recorte **nada**, pon `M365_OPENCODE_TOOLS=*` en el lanzador.

Dos avisos que cuestan tiempo si se olvidan:

- OpenCode manda los MCP **dentro de `execute`**, no como tools sueltas. Es decir,
  `execute` es la puerta de todos los MCP: si se recorta, no hay Office aunque el
  servidor esté conectado. Los lanzadores lo llevan; la lista por defecto del repo no
  (decisión antigua, medida en el bench: sin `execute` el modelo escribe bloques de
  shell).
- El log del proxy ahora dice también lo que **quita**:
  `OpenCode toolset: N/M kept — … | dropped — …`.

Copias de seguridad del cambio: `opencode.jsonc.bak-20261111_1723` y
`opencode.json.bak-20261111_1723`.

