import { describe, it, expect } from "vitest";
import { environmentUrlFromName, isTenantPolicyDenial } from "./agent.js";

describe("environmentUrlFromName", () => {
  it("splits the last two env-ID chars into their own DNS label", () => {
    expect(environmentUrlFromName("Default-fa7f56d8-49c4-4327-b816-9a0eeaa273df")).toBe(
      "https://defaultfa7f56d849c44327b8169a0eeaa273.df.environment.api.powerplatform.com",
    );
  });

  // Regression: the old hardcoded `.df.` only worked for IDs ending in "df".
  it("uses the real trailing chars, not a hardcoded `.df.`", () => {
    expect(environmentUrlFromName("Default-906AEFE9-76A7-4F65-B82D-5EC20775D5A1")).toBe(
      "https://default906aefe976a74f65b82d5ec20775d5.a1.environment.api.powerplatform.com",
    );
  });

  // A tenant whose `~default` environment is a plain GUID: its host has no
  // `default` prefix, so the prefixed form is NXDOMAIN. Ours is `Default-…`, which
  // is why this never showed up here.
  it("adds the `default` prefix only for Default- names", () => {
    expect(environmentUrlFromName("12345678-abcd-4ef0-9876-0123456789ab")).toBe(
      "https://12345678abcd4ef098760123456789.ab.environment.api.powerplatform.com",
    );
  });

  it("rejects a degenerate env ID", () => {
    expect(() => environmentUrlFromName("Default-")).toThrow(/Unexpected/);
  });
});

describe("agent provisioning policy", () => {
  // Recreating the bot cannot fix a switched-off tenant, and each attempt would
  // leave another unpublished bot behind, so it is remembered for the process.
  it("recognises the tenant-policy denial and nothing else", () => {
    expect(isTenantPolicyDenial("Publish failed: 403 CopilotExtensibilityNotEnabled")).toBe(true);
    expect(isTenantPolicyDenial("Failed to publish bot: 500 Internal Server Error")).toBe(false);
    expect(isTenantPolicyDenial(undefined)).toBe(false);
    expect(isTenantPolicyDenial("")).toBe(false);
  });
});
