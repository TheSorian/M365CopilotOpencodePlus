import { describe, it, expect } from "vitest";
import { corsAllowlist, corsHeaders, isAllowedOrigin, ORIGIN_REFUSED } from "./access.js";

// The policy exists because the proxy spends the signed-in M365 account for
// whoever reaches it: a LAN machine (closed by binding localhost) and any web
// page in the browser (closed here, since a page cannot hide its Origin).
describe("who may reach the proxy", () => {
  const localOnly: "*" | string[] = [];

  it("lets a client through when it sends no Origin at all", () => {
    // Every CLI harness — pi, opencode, curl — sends none.
    expect(isAllowedOrigin(null, localOnly)).toBe(true);
    expect(isAllowedOrigin(undefined, localOnly)).toBe(true);
    expect(isAllowedOrigin("", localOnly)).toBe(true);
  });

  it("refuses a page served from somewhere else", () => {
    expect(isAllowedOrigin("https://evil.example", localOnly)).toBe(false);
    expect(isAllowedOrigin("http://evil.example", localOnly)).toBe(false);
    // Lookalikes must not pass as localhost.
    expect(isAllowedOrigin("https://localhost.evil.example", localOnly)).toBe(false);
    expect(isAllowedOrigin("https://127.0.0.1.evil.example", localOnly)).toBe(false);
  });

  it("allows a desktop harness serving its UI from the machine", () => {
    expect(isAllowedOrigin("http://localhost:1420", localOnly)).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:3000", localOnly)).toBe(true);
    expect(isAllowedOrigin("https://localhost", localOnly)).toBe(true);
    expect(isAllowedOrigin("http://[::1]:4141", localOnly)).toBe(true);
    // Custom schemes: a web page cannot claim one.
    expect(isAllowedOrigin("tauri://localhost", localOnly)).toBe(true);
    expect(isAllowedOrigin("vscode-webview://abc", localOnly)).toBe(true);
  });

  it("refuses the opaque origin that file:// pages and sandboxed iframes send", () => {
    // A sandboxed iframe on a malicious page sends exactly this, so it is the
    // one origin a blanket "allow local" would let through.
    expect(isAllowedOrigin("null", localOnly)).toBe(false);
  });

  it("refuses something that is not an origin", () => {
    expect(isAllowedOrigin("not an origin", localOnly)).toBe(false);
  });

  it("honours an explicit allowlist", () => {
    expect(isAllowedOrigin("https://app.example", ["https://app.example"])).toBe(true);
    expect(isAllowedOrigin("https://other.example", ["https://app.example"])).toBe(false);
  });

  it("M365_CORS_ORIGIN=* opens everything, and empty means local only", () => {
    expect(isAllowedOrigin("https://evil.example", "*")).toBe(true);
    expect(corsAllowlist(undefined)).toEqual([]);
    expect(corsAllowlist("")).toEqual([]);
    expect(corsAllowlist("*")).toBe("*");
    expect(corsAllowlist(" https://a.example , https://b.example ")).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });
});

describe("CORS headers", () => {
  it("echoes the allowed origin instead of a wildcard", () => {
    const headers = corsHeaders("http://localhost:1420");
    expect(headers["Access-Control-Allow-Origin"]).toBe("http://localhost:1420");
    expect(headers.Vary).toBe("Origin");
  });

  it("sends none for a CLI client, which never reads them", () => {
    expect(corsHeaders(null)).toEqual({});
  });

  it("states why a request was refused, so the log is diagnosable", () => {
    expect(ORIGIN_REFUSED).toContain("M365_CORS_ORIGIN");
  });
});
