# Estado del proxy — traspaso (19 nov 2026)

Este archivo es para que otro programa/agente retome el trabajo sin reconstruir el
contexto. Para funcionamiento y ajustes de arranque, ver `NOTAS.md`; para el
protocolo, `docs/m365-copilot-api.md`; para hallazgos, `docs/hypotheses.md`.

## Objetivo del trabajo

Portar al repo propio, uno a uno y con su test, lo que merece la pena del original
(`upstream` = cramt/m365-copilot-proxy) y del fork (`bertogim`), dejando claro qué
entra y qué no. Restricciones: explicaciones llanas (sin tablas largas de hashes),
no traer la línea completa de Claude Code/Codex ni `M365_HARNESS_PROMPT` ni clave
API, y toda frase de rendición nueva debe detectarse también en castellano.

## Estado actual

Rama `main`, sincronizada con `origin/main`. Árbol limpio. Build y suite verdes:
**608 tests pasan** (`pnpm build` antes de `pnpm test`; los tests importan de
`dist/`).

Commits propios recientes (todos pusheados):
- `e999747` frases de rendición en castellano (`ni adjuntar` / `en este entorno`).
- `b04c25d` fix del fork: parser de payload JSON "desnudo" de `question`.
- `960fb70` modelos GPT-6.2 Sol/Astra y GPT-6 Astra, verificados en vivo.

## Qué se ha portado y qué NO

### SÍ entró
- Del fork (`bertogim e9e0182`): `parseQuestionCall` en
  `packages/core/src/tools.ts` acepta `{"questions":[...]}` o `[{...}]` cuando
  ocupan toda la respuesta y hay herramienta `question`. 3 tests.
- Del original (`upstream 693dc2c`), parcial: `gpt-6.2-sol` →
  `Gpt_62_Sol_Reasoning`, `gpt-6.2-astra` → `Gpt_62_Astra_Reasoning`,
  `gpt-6-astra` → `Gpt_6_Astra_Reasoning`. Los dos primeros en escenario
  incluido y sin metro; Astra en `PAID_SCENARIO_TONES`. Los tres con
  `relay_batch` por defecto y tests en `copilot.test.ts` / `fenced.test.ts`.

- Del original (`upstream ba10843` + `1365441`): cupo diario de turnos de cuentas no
  premium. `priorityAccessExhaustionOf` reconoce `TotalTurnDailyQuotaExhausted`, el proxy lo
  recuerda bajo una clave de cuenta, devuelve 429 `daily_turn_quota_exhausted` con
  `Retry-After` a medianoche UTC, no prueba modelos alternativos y expone el contador en
  `usage.x_m365_total_turns_daily_remaining`. La detección por texto solo cuenta en turnos
  que no tuvieron éxito, para que una respuesta que cita el rechazo no bloquee la cuenta.
  10 tests nuevos (6 en `priority-access.test.ts`, 4 en `streaming.test.ts`). Ver §47.

- Del original (`upstream c377501`): turno vacío con solo `EarlyProgress` bajo un
  escenario sin licencia -> 502 `scenario_not_served` en 1 turno, sin backoff. Con
  `getTurnRouting`/`INCLUDED_SCENARIO` en `core` y tests en `streaming.test.ts`.
- Del original (`upstream f5e428a`): `ChainOfThoughtSummary` se emite como
  `reasoning_content` (delta en streaming, campo en JSON, tambien en tool turns);
  `ChainOfThoughtComposer`, `onReasoning` y `M365_NO_REASONING=1`. 6 tests nuevos
  (`session-reasoning.test.ts`, `streaming.test.ts`) y sonda `scripts/cot-probe.mjs`.
- Del original (`upstream 5f91e70` + `8bf264d`): debug.log circular por
  `M365_LOG_MAX_BYTES` (50MB por defecto), corte en salto de linea y cierre del handle
  antes del rename en Windows. 4 tests en `log.test.ts`. La rotacion de 100MB de
  `start-m365.cmd` se mantiene como respaldo.
- Del original (`upstream c4b2ef4`): autenticacion por ruta de contraseña cuando la
  cuenta tiene passkey (autenticador WebAuthn vacio + pickers de AAD).

- Del original (`upstream 106ec97` + `29565ff`): los re-prompts de recuperación
  eligen el texto según las tools ofrecidas y `findRecognizedShellTool` no infiere un
  shell de un argumento cualquiera. 2 tests en `streaming.test.ts`.
- Del original (`upstream 7124b7e` + `f7e36ed`): `M365_LONG_ANSWER_GUARD`, apagado por
  defecto; 5 tests entre `tools.test.ts` y `streaming.test.ts`.
- Del original (`upstream 4df5a0d`): `M365_WORK_IQ=0` quita el entry BizChat y usa el
  escenario de pago en StreamHub (1 test en `session-streamhub.test.ts`). Activado por
  defecto, así que no cambia nuestro arranque.

- Del original (`upstream bca4ea4` + `29e1e4d`): conversaciones 24 h
  (`M365_CONVERSATION_TTL_HOURS`, máximo 1.000) y detección de historial perdido
  (`numUserMessagesInConversation` 1 en un turno de continuación): se frena antes de
  streaming y se reenvía toda la historia una vez por request; un opening respondido
  de ≥200k caracteres enseña al pool a reenviar siempre. 11 tests nuevos. **Única
  divergencia portada**: nuestro reintento de respuesta vacía ya reenvía el prompt
  completo en vez de "Please continue.", así que el test de opening no respondido se
  adaptó a ese comportamiento. Ver §50.

- Del original (`upstream scripts/`): sondas de solo lectura `chathub-tones.mjs`,
  `metering-probe.mjs`, `quota-{day.sh,direct.mjs,log.mjs,probe.sh}` y `cot-probe.mjs`,
  con sus 2 tests offline. 17 tests nuevos. No gastan cupo si no se ejecutan.

### NO entró (y por qué)
- `claude-fable` / `claude-fable-5.1`: en NUESTRA cuenta (incluida, no premium)
  el tono contesta pero se identifica como GPT-5 / junio 2024, igual que GPT-5.5;
  el Fable real da junio 2026 (§44 F122 del upstream). Sonnet y Opus dan la
  disculpa de BotConnection: no hay entitlement de Claude. Meterlo sería anunciar
  GPT-5 con nombre de Claude. Documentado en `hypotheses.md` §45.
- `c3059f3` (auth WAM de Windows, del original): descartado a petición; añade
  dependencias y no aporta modelos.
- El resto de commits de documentación del original (`bc7a780`, renumeraciones):
  no se trajeron.

### Ya estaba portado antes de este traspaso
- `9bba755` (bind localhost + rechazo de orígenes del original) → `3e74546`,
  con su test `access.test.ts`.
- StreamHub (`010cfd2`), subida a OneDrive (`17ec688`), restauración de lo que
  M365 borra en `[word]:` (`a4b7881`), fallback de Bing (`fc730b7`),
  prefijo `default` y detección de rendiciones (`950a93c`, `5909734`), y
  documentación asociada (`1b2000f`, `1a6fb9d`).

## Pruebas en vivo que se hicieron (cuenta PREMIUM del usuario - adif.es)

La cuenta tiene licencia completa Microsoft 365 Copilot Premium (soporte de escenario
de pago `OfficeWebPaidCopilot`, cuotas de prioridad y ejecución de agentes de Copilot
Studio verificados en vivo). La falta de respuesta en Claude se debe a restricciones de
proveedores de terceros (Anthropic) por políticas del tenant/EU Data Boundary, no a
falta de licencia.

Sondas secuenciales con `scripts/_probe-chat.mjs` + `getToken()`:
- `Gpt_6_Reasoning` (`gpt-6-think-deeper`) @ pago → DeepLeo (pong recibido OK).
- `Gpt_6_Sol_Reasoning` y `Gpt_61_Sol_Reasoning` con agente de Copilot Studio → DeepLeo (solo funciona en cuentas Premium).
- `Gpt_62_Sol_Reasoning` y `Gpt_62_Astra_Reasoning` @ incluido → DeepLeo.
- `Gpt_6_Astra_Reasoning` @ pago → DeepLeo, se identifica como GPT-6 (dic 2025).
- `Claude_Sonnet`, `Claude_Opus` → BotConnection disculpa (restringido por tenant/política de empresa para Anthropic).
- `Claude_Fable` → DeepLeo, pero redirige internamente a GPT-5 / jun 2024.

## Cosas útiles para seguir

- Catálogo y routing: `packages/core/src/copilot.ts` (`MODEL_TONES`,
  `getToneForModel`, `getScenarioForModel`, `PAID_SCENARIO_TONES`,
  `meteredBudgetOf`). Encuadres: `packages/core/src/fenced.ts`
  (`defaultFramingForTone`).
- Presupuestos: `packages/core/src/priority-access.ts`. La cuenta incluida no
  tiene cuotas diarias/semanales; solo Opus 5.5 y Sonnet 5.5 en pago.
- Límites medidos: ~600 mensajes por conversación; throttle por hilos a nivel de
  cuenta; Disengaged por forma del prompt.
- Auth en `~/.config/opencode-m365/` (`msal-cache.json`, `secrets.json`,
  `agent-id.json`, `debug.log`). No renombrar la carpeta.
- Remotos: `origin` (TheSorian), `upstream` (cramt), `bertogim`. El remoto
  `local` roto se eliminó. `origin/main` está al día.
- Comandos: `pnpm build` y luego `pnpm test`. Escribir mensajes de commit en
  `C:\Users\gsmsa\AppData\Local\Temp\opencode\` y usar
  `git commit -F`; estilo Conventional Commits, sin `Co-Authored-By`.
- El `search` dentro de Code Mode devuelve el catálogo de herramientas, no el
  repo. Para leer archivos de código usa `OfficeMCP.RunPython` con
  `pathlib` / `subprocess`; asigna el resultado a la variable `output`.

## Pendiente / hipótesis abierta

- `H44a` del upstream (no resuelta aquí): ¿los turnos incluidos de `gpt-6.2-*`
  gastan el presupuesto `GPT62*Query*`? No se midió. Si se quiere, leer
  `metering` antes y después de unos turnos incluidos.
- Los tres modelos nuevos están sin benchear (`relay_batch` heredado de sus
  hermanos GPT-6.x). Si se quiere rigor, correr `scripts/bench/` con `--label`.
- No se ha probado la ruta del agente de los GPT-6.2 (el upstream tampoco):
  quedan con la lógica por defecto (agente primero, fallback si está muerto).
