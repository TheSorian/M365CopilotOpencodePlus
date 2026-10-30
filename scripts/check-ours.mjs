#!/usr/bin/env node
/**
 * Tripwire for the deltas this repo carries on top of cramt's upstream: the
 * OpenCode patches inherited from Bertogim's fork, plus the files that exist
 * only here.
 *
 * A merge can apply cleanly and still leave one of these dead — renamed,
 * replaced by an upstream rewrite, or left behind a branch nothing reaches —
 * and neither `pnpm build` nor the unit tests always notice. update-m365.cmd
 * runs this straight after the merges and stops if anything is missing.
 *
 * Each entry names a behaviour, not a line. Renaming a symbol on purpose means
 * updating this list too, which is the point: a human looks at it.
 *
 *   node scripts/check-ours.mjs [root]
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "..");

/** @type {{ file: string, re: RegExp, why: string }[]} */
const CHECKS = [
  // Bertogim's fork: what makes the proxy usable from OpenCode at all.
  { file: "packages/core/src/tools.ts", re: /export function trimOpenCodeTools\(/, why: "recorte de tools del harness" },
  { file: "packages/core/src/tools.ts", re: /export function isOpenCodeHarness\(/, why: "deteccion del harness" },
  { file: "packages/core/src/tools.ts", re: /OPENCODE_DEFAULT_TOOLS/, why: "allowlist de tools por defecto" },
  { file: "packages/core/src/tools.ts", re: /M365_OPENCODE_TRIM/, why: "interruptor del recorte" },
  { file: "packages/core/src/tools.ts", re: /const CONFABULATION_PATTERNS/, why: "deteccion de confabulacion" },
  { file: "packages/core/src/tools.ts", re: /no\\s\+puedo/, why: "patrones en castellano" },
  { file: "packages/core/src/fenced.ts", re: /export function formatFencedToolDefinitions\(/, why: "definiciones de tools en fences" },
  { file: "packages/core/src/fenced.ts", re: /function harnessNotes\(/, why: "notas por harness" },
  { file: "packages/core/src/fenced.ts", re: /function parseApplyPatchHeredoc\(/, why: "apply_patch en heredoc" },
  { file: "packages/proxy-lib/src/handler.ts", re: /RESTORECONTEXT/, why: "restaurar contexto en un chat nuevo" },
  { file: "packages/proxy-lib/src/handler.ts", re: /M365_ALLOW_MULTI_TOOL/, why: "una tool por turno (con opt-out)" },
  { file: "packages/proxy-lib/src/handler.ts", re: /M365_EARLY_STOP_AFTER/, why: "corte del turno tras un tool_response inventado" },
  { file: "packages/core/src/session.ts", re: /class TurnTextComposer/, why: "ensamblado del texto por mensaje" },

  // Ours alone: nothing upstream can touch them, so a missing one means the
  // merge or a reset dropped it.
  { file: "NOTAS.md", re: /Arrancar/, why: "notas de esta instalacion" },
  { file: "start-m365.cmd", re: /M365_AVOID_THROTTLING/, why: "arranque del proxy" },
  { file: "update-m365.cmd", re: /bertogim\/main/, why: "script de actualizacion" },
  { file: ".gitignore", re: /^session-ses_\*\.md$/m, why: "ignorar exports de sesion" },
];

const missing = [];
for (const { file, re, why } of CHECKS) {
  const path = join(root, file);
  if (!existsSync(path) || !re.test(readFileSync(path, "utf8"))) missing.push({ file, why });
}

if (missing.length === 0) {
  console.log(`  OK: los ${CHECKS.length} deltas propios siguen en su sitio.`);
  process.exit(0);
}

console.error("");
for (const { file, why } of missing) console.error(`  FALTA  ${file}  ->  ${why}`);
console.error("");
console.error(`  ${missing.length} de ${CHECKS.length} deltas no estan. Un merge se los ha llevado.`);
console.error("  Nada se ha perdido: la version buena es el commit anterior al merge.");
console.error("  Para volver atras:  git reset --hard pre-update");
process.exit(1);
