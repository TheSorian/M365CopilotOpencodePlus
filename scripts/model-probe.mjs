// Which advertised model IDs actually answer, through the running proxy.
//
// 37 model IDs collapse to 23 distinct (tone, scenario) routes — aliases share
// one — so each route is probed ONCE and every ID that resolves to it inherits
// the verdict. That keeps a full sweep at 23 fresh conversations instead of 37,
// which matters because the throttle counts upstream turns (hyp §9 F13, §24 F58).
//
// Three-state verdicts, as scripts/tone-probe.mjs insists (§12.15): a non-empty
// reply is not proof of anything on its own, but through the proxy a 200 with
// text means the tone reached a model. What the proxy adds is its own paths:
// premium-only 502, priority-access 429, context 400, Disengaged 502.
//
// Usage: node scripts/model-probe.mjs [--gap-ms=2500] [--out=<dir>]
// Run it with the proxy up (M365_AVOID_THROTTLING=1 there paces the turns).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getToneForModel, getScenarioForModel } from "../packages/core/dist/index.mjs";

const BASE = process.env.M365_PROXY_URL ?? "http://127.0.0.1:4141/v1";
const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const GAP_MS = Number(arg("gap-ms", 2500));
const OUT = arg("out", join(process.cwd(), "scripts", "tone-out", `models-${new Date().toISOString().replace(/[:.]/g, "-")}`));

const list = await (await fetch(`${BASE}/models`)).json();
const ids = list.data.map((m) => m.id);
console.log(`[model] ${ids.length} model IDs advertised by the proxy`);

/** Route key: what M365 actually serves, so aliases collapse. */
const routeOf = (id) => `${getToneForModel(id)}@${getScenarioForModel(id).scenario}`;
/** One representative per route: the shortest ID (aliases add noise to the prompt). */
const repByRoute = new Map();
for (const id of ids) {
  const key = routeOf(id);
  const prev = repByRoute.get(key);
  if (!prev || id.length < prev.length) repByRoute.set(key, id);
}
const routes = [...repByRoute.entries()];
console.log(`[model] ${routes.length} distinct routes → one turn each\n`);

function verdictOf(status, body) {
  const text = (body?.choices?.[0]?.message?.content ?? "").trim();
  const code = body?.error?.code ?? "";
  const msg = body?.error?.message ?? (typeof body === "string" ? body.slice(0, 160) : "");
  if (status === 200) return text ? "OK" : "OK_EMPTY";
  if (status === 429) return code.includes("priority") || /quota|credit|budget/i.test(msg) ? "SIN_CUOTA" : "THROTTLED";
  if (status === 400) return "CONTEXTO";
  if (status === 502) {
    if (/premium|not premium|cuenta/i.test(msg)) return "SOLO_PREMIUM";
    if (/disengag/i.test(msg) || /disengag/i.test(code)) return "DISENGAGED";
    return "ERROR_502";
  }
  return `ERROR_${status}`;
}

const results = [];
for (const [route, rep] of routes) {
  const started = Date.now();
  let row;
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: rep,
        messages: [{ role: "user", content: "Reply with exactly the single word: pong" }],
        stream: false,
        max_tokens: 64,
      }),
      signal: AbortSignal.timeout(180000),
    });
    const raw = await res.text();
    let body;
    try { body = JSON.parse(raw); } catch { body = raw; }
    const text = (body?.choices?.[0]?.message?.content ?? "").trim();
    row = {
      route, rep, status: res.status, verdict: verdictOf(res.status, body),
      reply: text.slice(0, 60),
      error: body?.error ? `${body.error.code ?? ""} ${String(body.error.message ?? "").slice(0, 140)}` : "",
      servedModel: body?.model ?? "",
      elapsedMs: Date.now() - started,
      ids: ids.filter((id) => routeOf(id) === route),
    };
  } catch (err) {
    row = {
      route, rep, status: 0, verdict: "TIMEOUT/NO_RESPONSE", reply: "", error: String(err?.message ?? err),
      servedModel: "", elapsedMs: Date.now() - started, ids: ids.filter((id) => routeOf(id) === route),
    };
  }
  results.push(row);
  console.log(
    `[model] ${row.verdict.padEnd(19)} ${String(row.status).padEnd(4)} ${route.padEnd(38)} via ${row.rep.padEnd(22)} ${String(row.elapsedMs).padStart(6)}ms ${row.error ? "| " + row.error : ""} ${row.reply ? "| " + JSON.stringify(row.reply) : ""}`,
  );
  if (row.verdict === "THROTTLED") {
    console.log("[model] throttled — stopping the sweep (a throttled turn is the account, not the model)");
    break;
  }
  await new Promise((r) => setTimeout(r, GAP_MS));
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));

console.log("\n[model] === POR MODELO ===");
for (const r of results) {
  for (const id of r.ids) console.log(`  ${id.padEnd(26)} ${r.verdict}  (${r.route})`);
}
const tally = {};
for (const r of results) tally[r.verdict] = (tally[r.verdict] ?? 0) + r.ids.length;
console.log("\n[model] resumen:", JSON.stringify(tally));
console.log(`[model] out: ${OUT}`);
