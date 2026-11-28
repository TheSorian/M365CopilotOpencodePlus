import { getToken } from "@m365-copilot/core";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const STATE = join(homedir(), ".config", "opencode-m365", "auth-notify.json");

/**
 * Notify on the FIRST failure of an outage only, when M365_AUTH_NOTIFY=1 is
 * set (off by default so other hosts pulling main don't also send duplicate
 * alerts). systemd restarts a failed unit every 5s, so a per-restart ping
 * would spam; and once the user knows the password changed, repeating the same
 * message adds nothing. The flag clears itself on the next successful login, so
 * a future outage gets its own ping.
 * Best effort: a notification failure must never break proxy boot.
 */
function notifyAuthFailure(reason: string): void {
  if (process.env.M365_AUTH_NOTIFY !== "1") return;
  try {
    if (existsSync(STATE) && JSON.parse(readFileSync(STATE, "utf8")).pending) return;
    mkdirSync(join(homedir(), ".config", "opencode-m365"), { recursive: true });
    writeFileSync(STATE, JSON.stringify({ pending: true, at: Date.now() }));
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

/** A successful login re-arms the one-shot notification for the next outage. */
function clearAuthFailure(): void {
  try {
    if (existsSync(STATE)) writeFileSync(STATE, JSON.stringify({ pending: false }));
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
    clearAuthFailure();
  } catch (err: any) {
    const reason = String(err?.message ?? err);
    console.error(`Auth failed: ${reason}`);
    notifyAuthFailure(reason);
    throw err;
  }
});
