import { getToken } from "@m365-copilot/core";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const STATE = join(homedir(), ".config", "opencode-m365", "auth-notify.json");
const COOLDOWN_MS = 10 * 60_000;

/** Best-effort Telegram ping. Never let a notification failure break boot. */
function notifyAuthFailure(reason: string): void {
  if (process.env.M365_NO_AUTH_NOTIFY === "1") return;
  // systemd restarts a failed unit every 5s: without a cooldown this would
  // spam Telegram. One ping per 10 minutes is enough to act on it.
  try {
    const now = Date.now();
    let last = 0;
    if (existsSync(STATE)) last = Number(JSON.parse(readFileSync(STATE, "utf8")).at) || 0;
    if (now - last < COOLDOWN_MS) return;
    mkdirSync(join(homedir(), ".config", "opencode-m365"), { recursive: true });
    writeFileSync(STATE, JSON.stringify({ at: now }));
  } catch {}

  const text =
    `⚠️ M365 proxy: falló el login automático.\n` +
    `Motivo: ${reason}\n` +
    `Si ha cambiado la contraseña, ejecuta: sudo m365-update-password\n` +
    `Capturas: ~/.config/opencode-m365/login-debug/`;
  try {
    const child = spawn("notify-telegram", [text], { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {}
}

/**
 * Authenticate against M365 once, at server startup. A failure here throws and
 * aborts boot — the equivalent of the old binary's `process.exit(1)` on auth
 * failure, so the server never comes up half-broken.
 */
export default defineNitroPlugin(async () => {
  console.log("Authenticating...");
  try {
    await getToken();
  } catch (err: any) {
    const reason = String(err?.message ?? err);
    console.error(`Auth failed: ${reason}`);
    notifyAuthFailure(reason);
    throw err;
  }
});
