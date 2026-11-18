/**
 * Who may talk to the proxy (#93, ported from upstream 9bba755 without the
 * optional API key).
 *
 * The standalone server listened on every interface, answered CORS `*` and asked
 * for nothing, so any page open in the browser — or any machine on the LAN —
 * could spend the signed-in M365 account. Binding to localhost closes the LAN but
 * not the browser: a cross-origin POST still reaches it, and a page that rebinds
 * its own DNS to 127.0.0.1 is *same-origin* to the browser, so no CORS header can
 * stop it. What a page cannot hide is the `Origin` it sends, which is why the
 * policy reads that header and refuses the request outright instead of relying on
 * the browser to enforce anything.
 *
 * Local origins are allowed on purpose: a desktop harness serves its UI from
 * localhost or a custom scheme, and refusing it would break the very client this
 * proxy exists for. Anything claiming to be a web page somewhere else is refused.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Reasons a refused request gives back, in the OpenAI error shape. */
export const ORIGIN_REFUSED =
  "This proxy refuses requests that carry a non-local browser Origin. " +
  "Set M365_CORS_ORIGIN to a comma-separated allowlist (or `*`) to change that.";

/** What `M365_CORS_ORIGIN` says: `*` for any origin, a list, or empty for local ones. */
export function corsAllowlist(
  raw: string | undefined = process.env.M365_CORS_ORIGIN,
): "*" | string[] {
  const value = raw?.trim();
  if (!value) return [];
  if (value === "*") return "*";
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** May a request carrying this `Origin` reach the proxy?
 *
 *  No header at all is the normal case: every CLI harness sends none, so it is
 *  allowed. `Origin: null` is refused — that is what a `file://` page and a
 *  sandboxed iframe on a malicious site both send, and the second one is exactly
 *  the attacker this policy exists for.
 */
export function isAllowedOrigin(
  origin: string | null | undefined,
  allowlist: "*" | string[] = corsAllowlist(),
): boolean {
  if (!origin) return true;
  if (allowlist === "*") return true;
  if (allowlist.includes(origin)) return true;
  if (origin === "null") return false;

  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false; // not an origin at all
  }

  if (url.protocol === "http:" || url.protocol === "https:") {
    return LOCAL_HOSTS.has(url.hostname.toLowerCase());
  }
  // A custom scheme (tauri://localhost, vscode-webview://…): a page served over
  // http(s) cannot claim one, so a desktop client's UI can reach us.
  return true;
}

/** CORS headers for an allowed request. The origin is echoed, never `*`, so the
 *  browser only lets through the client that was actually allowed. */
export function corsHeaders(origin: string | null | undefined): Record<string, string> {
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, x-api-key, anthropic-version, anthropic-beta",
  };
}
