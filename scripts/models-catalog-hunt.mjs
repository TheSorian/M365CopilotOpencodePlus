// Hunt for the MODEL CATALOGUE the first-party M365 Copilot web client receives.
//
// Why: /v1/models advertises all 34 MODEL_TONES keys regardless of the account,
// and entitlement (paid scenario) is only visible when a model is actually used.
// If the web client is TOLD which models/tiers its account has, we can read that
// payload instead of probing every model with a chat turn.
//
// Already ruled out (2026-11-11, scripts/frame-dump-probe.mjs, one turn): the
// chat hub over SignalR sends NO catalogue. Frame types 1/2/3 only; the keys are
// throttling, scores, messageId, references, locationInfo. So if a catalogue
// exists it is HTTP, and this script looks for it.
//
// Read-only: logs in, opens the chat, opens the model picker if it can find one,
// and captures responses + inline state. It never sends a chat message, so it
// costs 0 chat turns.
//
// Needs a way in, in this order:
//   1. ~/.config/opencode-m365/secrets.json (email/password/mfaSecret) - the
//      normal automated login, and what a freshly set-up machine has;
//   2. the proxy's already-signed-in Playwright profile (browser-profile).
//
// Usage: node scripts/models-catalog-hunt.mjs
//        CHROMIUM_PATH=<chrome.exe>   # if Playwright's own chromium is missing
//
// Outputs (gitignored): scripts/models-catalog-out/results.json + picker.png
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadSecrets } from "../packages/core/dist/index.mjs";

const OUT = join(process.cwd(), "scripts", "models-catalog-out");
mkdirSync(OUT, { recursive: true });
const creds = loadSecrets();
const PROFILE = join(homedir(), ".config", "opencode-m365", "browser-profile");
const useProfile = !creds && existsSync(PROFILE);
if (!creds && !useProfile) { console.log("no secrets.json and no browser profile"); process.exit(1); }
console.log(creds ? "[hunt] auth: secrets.json" : "[hunt] auth: existing browser profile");

import { pathToFileURL } from "node:url";
const ROOT = pathToFileURL(process.cwd()).href;
const pwMod = await import(`${ROOT}/node_modules/.pnpm/playwright@1.58.2/node_modules/playwright/index.js`);
const chromium = pwMod.chromium ?? pwMod.default?.chromium;
const { TOTP } = await import(`${ROOT}/node_modules/.pnpm/otpauth@9.5.0/node_modules/otpauth/dist/otpauth.esm.js`);

// Strings only a model catalogue (or its picker) would contain.
const MARKERS = /Gpt_[0-9]|GPT-?[456]|Claude[_ ]?(Opus|Sonnet)|Think [Dd]eeper|Claude_Sonnet|Gpt_6_Sol|OfficeWebPaid|OfficeWebIncluded/i;

const launchArgs = ["--no-sandbox", "--disable-dev-shm-usage"];
const launchOpts = { headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: launchArgs };
const ctx = useProfile ? await chromium.launchPersistentContext(PROFILE, launchOpts) : null;
const browser = ctx ?? await chromium.launch(launchOpts);
const page = ctx ? (ctx.pages()[0] ?? await ctx.newPage()) : await browser.newPage();

const seen = [];   // every XHR/fetch/document: method, url, status, type
const hits = [];   // responses whose body mentions model names

async function scan(url, status, ct, body, kind) {
  if (!body || !MARKERS.test(body)) return;
  hits.push({ kind, url: url.split("?")[0], status, ct: ct.slice(0, 40), bytes: body.length, body: body.slice(0, 400000) });
  console.log(`[hit] ${kind} ${status} ${url.split("?")[0]} (${body.length} bytes)`);
}

page.on("response", async (res) => {
  const req = res.request();
  const type = req.resourceType();
  const kind = type === "document" ? "document" : (type === "xhr" || type === "fetch") ? "api" : null;
  if (!kind) return;
  const url = res.url();
  const ct = (res.headers()["content-type"] ?? "").toLowerCase();
  seen.push({ method: req.method(), url: url.split("?")[0], status: res.status(), kind, ct: ct.slice(0, 40) });
  if (!/json|javascript|html/.test(ct)) return;
  let body = "";
  try { body = await res.text(); } catch { return; }
  await scan(url, res.status(), ct, body, kind);
});

async function login() {
  const fill = async (sel, val) => { const loc = page.locator(`${sel}:visible`).first(); await loc.waitFor({ state: "visible", timeout: 30000 }); await loc.fill(val); };
  const submit = () => page.locator('input[type="submit"]:visible, button[type="submit"]:visible').first().click();
  await fill('input[name="loginfmt"]', creds.email); await submit(); await page.waitForTimeout(2500);
  await fill('input[name="passwd"]', creds.password); await submit(); await page.waitForTimeout(2500);
  try { await fill('input[name="otc"]', new TOTP({ secret: creds.mfaSecret }).generate()); await submit(); await page.waitForTimeout(2500); } catch {}
  try { await page.locator("#idSIButton9:visible").click({ timeout: 8000 }); } catch {}
}

const linesAboutModels = () => page.evaluate(() => {
  const t = document.body.innerText || "";
  return t.split("\n").filter((l) => /GPT|Claude|Think deeper|Sol|modelo/i.test(l)).slice(0, 60);
}).catch(() => []);

try {
  console.log("[hunt] navigating to M365 Copilot chat...");
  await page.goto("https://m365.cloud.microsoft/chat/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);
  const signin = () => /login\.microsoftonline|oauth2|signin|\/login/i.test(page.url());
  if (signin()) {
    if (!creds) { console.log("[hunt] profile is not signed in and there is no secrets.json - cannot continue"); }
    else { console.log("[hunt] login..."); await login(); }
  }
  await page.waitForTimeout(9000);
  console.log("[hunt] url:", page.url());
  if (signin()) throw new Error("still on the sign-in page after login");

  const domMarkers = await linesAboutModels();
  console.log(`[hunt] DOM lines mentioning models: ${domMarkers.length}`);
  for (const line of domMarkers.slice(0, 12)) console.log(`   | ${line.trim().slice(0, 120)}`);

  // Try to open a model picker: aria-label/testid first, then the marker text.
  const pickers = [
    '[aria-label*="model" i]:visible',
    '[data-testid*="model" i]:visible',
    'button:has-text("GPT"):visible',
    'button:has-text("Think deeper"):visible',
    '[role="button"]:has-text("GPT"):visible',
  ];
  let opened = null;
  for (const sel of pickers) {
    const loc = page.locator(sel).first();
    if (await loc.count().catch(() => 0)) {
      await loc.click({ timeout: 5000 }).catch(() => {});
      opened = sel;
      console.log(`[hunt] opened picker with: ${sel}`);
      break;
    }
  }
  await page.waitForTimeout(6000);
  const menuLines = await linesAboutModels();
  await page.screenshot({ path: join(OUT, "picker.png"), fullPage: false }).catch(() => {});

  // The picker list often rides inline state rather than a visible request.
  const inline = await page.evaluate(() => {
    const found = [];
    try {
      const html = document.documentElement.outerHTML;
      for (const m of html.matchAll(/[^"'<>\\]{0,80}(?:Gpt_[0-9]|Claude_(?:Opus|Sonnet)|OfficeWeb(?:Paid|Included)Copilot)[^"'<>\\]{0,80}/g)) found.push(m[0]);
    } catch {}
    for (const store of [localStorage, sessionStorage]) {
      try {
        for (let i = 0; i < store.length; i++) {
          const k = store.key(i);
          const v = store.getItem(k) ?? "";
          if (/Gpt_[0-9]|Claude_(?:Opus|Sonnet)|OfficeWeb(?:Paid|Included)Copilot/i.test(k + v)) {
            found.push(`${store === localStorage ? "localStorage" : "sessionStorage"}:${k}=${v.slice(0, 2000)}`);
          }
        }
      } catch {}
    }
    return [...new Set(found)].slice(0, 200);
  }).catch(() => []);
  console.log(`[hunt] inline state matches: ${inline.length}`);
  for (const line of inline.slice(0, 10)) console.log(`   ~ ${line.slice(0, 160)}`);
  if (inline.length) await scan(page.url(), page.url() ? 200 : 0, "text/html", inline.join("\n"), "inline");

  writeFileSync(join(OUT, "results.json"), JSON.stringify({
    url: page.url(), pickerSelector: opened, domMarkers, menuLines, inline, requests: seen, hits,
  }, null, 2));
  console.log(`\n[hunt] === RESULT === requests=${seen.length} hits=${hits.length} inline=${inline.length} picker=${opened ?? "none"}`);
  for (const h of hits) console.log(`   ${h.kind} ${h.status} ${h.url} (${h.bytes}b)`);
} catch (e) {
  console.log("[hunt] ERR", e.message);
  writeFileSync(join(OUT, "results.json"), JSON.stringify({ error: e.message, url: page.url(), requests: seen, hits }, null, 2));
}

await browser.close();
console.log(`[hunt] written: ${OUT}/results.json`);
