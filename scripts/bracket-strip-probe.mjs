// Does M365 eat "[word]:" out of a reply before it reaches us — and does the
// delta-built text survive it?
//
// Upstream (fc998f4) found M365's post-processing deletes a bracketed word, the
// colon after it and the whitespace after that from a message's FINAL text, code
// blocks included and not every time: `[regex]::Replace(` arrives as `:Replace(`.
// In a Codex run 4 of 4 in-place PowerShell edits then wrote the resulting
// nothing over the file.
//
// The proxy assembles text per message (TurnTextComposer): deltas extend a
// message, then a final snapshot replaces it. `foldStreamText` keeps the LONGER
// of the two, so if the deletion is only in the snapshot we already keep the
// model's own text. If the deletion is in the deltas too, we need the fix.
//
//   node scripts/bracket-strip-probe.mjs            # 1 thread, 1 message
//   MODEL=claude-sonnet node scripts/bracket-strip-probe.mjs
//
// Cost: one fresh conversation per run — space runs out (thread throttle).
import { ModelSession } from "../packages/core/dist/index.mjs";

const MODEL = process.env.MODEL ?? "gpt-5.6-think-deeper";
const ASK = [
  "Write exactly the two lines below, inside one powershell code block, and nothing else.",
  'Do not change them, do not explain them, do not use the tools:',
  "",
  "```powershell",
  '$updated = [regex]::Replace($text, "3000", "8080")',
  "Set-Content -Path config.json -Value $updated",
  "```",
].join("\n");

const NEEDLES = ["[regex]::Replace(", "[regex]", "Replace("];

function has(text, needle) {
  return text.includes(needle);
}

const session = new ModelSession({ temporaryChat: true });
const stream = await session.run(ASK, MODEL, undefined, false);

let deltas = "";
for await (const d of stream) deltas += d;
const final = stream.fullText ?? "";

console.log(`model:        ${MODEL}`);
console.log(`result:       ${stream.result?.value ?? "?"}${stream.result?.errorCode ? ` (${stream.result.errorCode})` : ""}`);
console.log(`messageType:  ${stream.messageType ?? "-"}   contentOrigin: ${stream.contentOrigin ?? "-"}`);
console.log(`disengaged:   ${stream.messageType === "Disengaged"}`);
console.log(`deltas:       ${deltas.length} chars`);
console.log(`fullText:     ${final.length} chars`);
console.log(`identical:    ${deltas.trim() === final.trim()}`);
console.log();
for (const needle of NEEDLES) {
  console.log(`${JSON.stringify(needle).padEnd(20)} deltas ${has(deltas, needle) ? "OK  " : "GONE"}   fullText ${has(final, needle) ? "OK  " : "GONE"}`);
}
console.log();
console.log("--- deltas ---");
console.log(JSON.stringify(deltas));
console.log();
console.log("--- fullText (what the proxy returns) ---");
console.log(JSON.stringify(final));

// Falsification: the token survives in both. Then this quirk does not reach us
// and there is nothing to port. If fullText lost it while deltas kept it, the
// composer is at fault (our bug). If both lost it, the damage is upstream of us
// and the fix (align deltas with the final text, keep the model's own) is needed.
