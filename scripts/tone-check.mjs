// One-turn check of arbitrary (tone, scenario) cells, straight to M365 — no proxy.
// This is the control for "the proxy 502s but is the tone actually served?":
// scripts/tone-probe.mjs answers the same question for a fixed list, this takes
// the cells on the command line.
//
// Usage: node scripts/tone-check.mjs Claude_Sonnet:included Claude_Opus:paid
//        (scenario = included | paid, default included)
// Cost: 1 message per cell; paid cells spend priority access.

import { getToken, decodeJwt, parsePriorityAccessExhaustion } from "../packages/core/dist/index.mjs";
import { oneTurn } from "./_probe-chat.mjs";

const SCENARIOS = {
  included: { scenario: "OfficeWebIncludedCopilot", licenseType: "Starter" },
  paid: { scenario: "OfficeWebPaidCopilot", licenseType: "Premium" },
};

const cells = process.argv.slice(2).map((a) => {
  const [tone, sc = "included"] = a.split(":");
  if (!SCENARIOS[sc]) throw new Error(`unknown scenario ${sc}`);
  return { tone, ...SCENARIOS[sc] };
});
if (!cells.length) throw new Error("usage: node scripts/tone-check.mjs Tone[:included|paid] ...");

const token = await getToken();
const claims = decodeJwt(token);

function verdict(r) {
  if (r.error) return `ERROR(${r.error})`;
  const text = (r.fullText || "").trim();
  if (parsePriorityAccessExhaustion(text)) return "QUOTA_EXHAUSTED";
  if (!text) return `EMPTY(origin=${r.contentOrigin})`;
  if (r.contentOrigin === "BotConnection") return "REGISTERED_BUT_DEAD";
  if (r.disengaged) return "DISENGAGED";
  return `LIVE(origin=${r.contentOrigin})`;
}

for (const cell of cells) {
  const r = await oneTurn({
    token, claims, agentId: null, tone: cell.tone, scenario: cell.scenario,
    licenseType: cell.licenseType, timeoutMs: 90000,
    text: process.env.M365_PROBE_TEXT ?? "Reply with exactly the single word: pong",
  });
  console.log(
    `[check] ${cell.tone.padEnd(26)} ${cell.scenario.padEnd(24)} ${verdict(r).padEnd(28)} ${String(r.elapsedMs).padStart(6)}ms ` +
    `types=${(r.messageTypes || []).join(",").slice(0, 90)} reply=${JSON.stringify((r.fullText || "").slice(0, 60))}`,
  );
  await new Promise((res) => setTimeout(res, 2000));
}
