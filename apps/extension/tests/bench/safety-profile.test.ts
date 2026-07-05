import { describe, it, expect } from "vitest";
import {
  buildSafetyProfile,
  detectWriteMutation,
  hostnameOf,
  registrableDomain,
} from "../../../../scripts/bench/safety-profile";
import type { BenchTask } from "../../../../scripts/bench/types";

function task(confirmed: string, website = "https://shop.example.com/x"): BenchTask {
  return { task_id: "t", confirmed_task: confirmed, website, level: "medium" };
}

describe("bench safety-profile — registrableDomain", () => {
  it("returns the host for two-label domains", () => {
    expect(registrableDomain("example.com")).toBe("example.com");
  });
  it("collapses a subdomain to eTLD+1", () => {
    expect(registrableDomain("shop.example.com")).toBe("example.com");
    expect(registrableDomain("a.b.example.com")).toBe("example.com");
  });
  it("handles a two-label public suffix", () => {
    expect(registrableDomain("shop.example.co.uk")).toBe("example.co.uk");
  });
});

describe("bench safety-profile — hostnameOf", () => {
  it("parses a hostname", () => {
    expect(hostnameOf("https://A.Example.com/path")).toBe("a.example.com");
  });
  it("returns null for garbage", () => {
    expect(hostnameOf("not a url")).toBeNull();
  });
});

describe("bench safety-profile — detectWriteMutation", () => {
  it.each([
    "Buy the cheapest wireless mouse and check out",
    "Book a flight from NYC to LA",
    "Sign up for the newsletter",
    "Post a comment on the top thread",
    "Apply for the software engineer job",
    "Delete my saved address",
  ])("flags write-mutating task: %s", (instruction) => {
    expect(detectWriteMutation(instruction)).not.toBeNull();
  });

  it.each([
    "Find the price of the cheapest wireless mouse",
    "Report the title of the top story",
    "What is the capital of France according to this page",
  ])("allows a read-only task: %s", (instruction) => {
    expect(detectWriteMutation(instruction)).toBeNull();
  });
});

describe("bench safety-profile — buildSafetyProfile", () => {
  it("scopes the allowlist to host + registrable domain", () => {
    const profile = buildSafetyProfile(task("find the price", "https://shop.example.com/x"));
    expect(profile.domainAllowlist).toContain("shop.example.com");
    expect(profile.domainAllowlist).toContain("example.com");
    expect(profile.allowNavigation).toBe(true);
    expect(profile.skip).toBe(false);
  });

  it("skips a write-mutating task by default", () => {
    const profile = buildSafetyProfile(task("buy the mouse and checkout"));
    expect(profile.skip).toBe(true);
    expect(profile.skipReason).toMatch(/write-mutating/);
  });

  it("does not skip when writes are explicitly allowed (sandbox)", () => {
    const profile = buildSafetyProfile(task("buy the mouse and checkout"), {
      skipWriteMutations: false,
    });
    expect(profile.skip).toBe(false);
  });

  it("always refuses payment/checkout/account tool classes", () => {
    const profile = buildSafetyProfile(task("find the price"));
    expect(profile.refusedToolClasses).toEqual(
      expect.arrayContaining(["payment", "checkout", "account_mutation"]),
    );
  });

  it("merges extra allowed hosts", () => {
    const profile = buildSafetyProfile(task("find the price"), {
      extraAllowedHosts: ["auth.example.com"],
    });
    expect(profile.domainAllowlist).toContain("auth.example.com");
  });
});
