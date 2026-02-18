import { describe, expect, test } from "bun:test";
import { getBlockedRuleForUrl, getSiteAccessRules, matchBlockedRule } from "../../src/utils/site-access";
import type { UserSettings } from "../../src/types";

const blocklistSettings: UserSettings = {
  siteAccessMode: "blocklist",
  siteAccessBlocklist: ["example.com", "*.internal.local", "https://admin.acme.org/path"],
};

describe("site access blocklist", () => {
  test("normalizes blocklist rules to hosts", () => {
    expect(getSiteAccessRules(blocklistSettings)).toEqual([
      "example.com",
      "internal.local",
      "admin.acme.org",
    ]);
  });

  test("matches exact and subdomain hosts", () => {
    const rules = getSiteAccessRules(blocklistSettings);
    expect(matchBlockedRule("example.com", rules)).toBe("example.com");
    expect(matchBlockedRule("app.example.com", rules)).toBe("example.com");
    expect(matchBlockedRule("foo.internal.local", rules)).toBe("internal.local");
    expect(matchBlockedRule("safe-site.com", rules)).toBeNull();
  });

  test("blocks urls only when mode is blocklist", () => {
    expect(
      getBlockedRuleForUrl("https://dash.example.com/home", blocklistSettings),
    ).toEqual({
      host: "dash.example.com",
      rule: "example.com",
    });

    const allowAll: UserSettings = {
      siteAccessMode: "allow_all",
      siteAccessBlocklist: ["example.com"],
    };
    expect(getBlockedRuleForUrl("https://example.com", allowAll)).toBeNull();
  });
});
