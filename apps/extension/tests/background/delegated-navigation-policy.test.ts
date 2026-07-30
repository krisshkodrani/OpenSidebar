import { describe, expect, test } from "vitest";

import {
  isUrlAllowedByDelegatedPolicy,
  normalizeAllowedDomains,
} from "../../src/background/infrastructure/delegated-navigation-policy";

describe("delegated navigation policy", () => {
  test("normalizes hostnames and preserves explicit wildcard/port boundaries", () => {
    expect(
      normalizeAllowedDomains([
        "HTTPS://Play.Google.com/path",
        "*.Example.com:8443",
        "play.google.com",
      ]),
    ).toEqual(["play.google.com", "*.example.com:8443"]);
  });

  test("matches exact domains and wildcard subdomains without suffix confusion", () => {
    const exact = { allowedDomains: ["play.google.com"] };
    expect(
      isUrlAllowedByDelegatedPolicy(
        "https://play.google.com/console",
        exact,
      ),
    ).toBe(true);
    expect(
      isUrlAllowedByDelegatedPolicy(
        "https://play.google.com.evil.example",
        exact,
      ),
    ).toBe(false);

    const wildcard = { allowedDomains: ["*.example.com"] };
    expect(
      isUrlAllowedByDelegatedPolicy("https://a.b.example.com/path", wildcard),
    ).toBe(true);
    expect(
      isUrlAllowedByDelegatedPolicy("https://notexample.com/path", wildcard),
    ).toBe(false);
  });

  test("rejects non-web protocols and enforces explicit ports", () => {
    const policy = { allowedDomains: ["localhost:4173"] };
    expect(
      isUrlAllowedByDelegatedPolicy("http://localhost:4173/form", policy),
    ).toBe(true);
    expect(
      isUrlAllowedByDelegatedPolicy("http://localhost:4174/form", policy),
    ).toBe(false);
    expect(isUrlAllowedByDelegatedPolicy("file:///tmp/a", policy)).toBe(false);
  });
});
