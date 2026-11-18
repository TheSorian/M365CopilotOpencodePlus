import { corsAllowlist, corsHeaders, isAllowedOrigin, ORIGIN_REFUSED } from "@m365-copilot/proxy-lib";

/**
 * Origin policy for every route (#93).
 *
 * Upstream's fix also carries an optional API key; ours is the binding half only:
 * the server listens on localhost (bin/m365-proxy.mjs) and this refuses anything
 * that arrives carrying a browser Origin from somewhere else. Returning a value
 * from h3 middleware ends the request there, which is what makes the refusal
 * work for simple cross-origin POSTs that CORS would only hide the answer to.
 */
export default defineEventHandler((event) => {
  const origin = getRequestHeader(event, "origin") ?? null;

  if (!isAllowedOrigin(origin, corsAllowlist())) {
    setResponseStatus(event, 403);
    return { error: { message: ORIGIN_REFUSED, type: "invalid_request_error" } };
  }

  for (const [k, v] of Object.entries(corsHeaders(origin))) {
    setResponseHeader(event, k, v);
  }

  if (event.method === "OPTIONS") {
    setResponseStatus(event, 204);
    return "";
  }
});
