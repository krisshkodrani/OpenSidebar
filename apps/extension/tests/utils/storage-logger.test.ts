import { describe, test, expect } from "vitest";
import { sanitizeData } from "../../src/utils/storage-logger";

describe("sanitizeData", () => {
  test("returns undefined for undefined input", () => {
    expect(sanitizeData(undefined)).toBeUndefined();
  });

  test("redacts keys containing apikey, api_key, token, secret, password", () => {
    const result = sanitizeData({
      apiKey: "sk-secret-12345",
      openRouterApiKey: "or-secret-67890",
      api_key: "abc",
      token: "bearer-abc",
      mySecret: "shhh",
      password: "hunter2",
    });

    expect(result!.apiKey).toBe("[REDACTED]");
    expect(result!.openRouterApiKey).toBe("[REDACTED]");
    expect(result!.api_key).toBe("[REDACTED]");
    expect(result!.token).toBe("[REDACTED]");
    expect(result!.mySecret).toBe("[REDACTED]");
    expect(result!.password).toBe("[REDACTED]");
  });

  test("keeps non-sensitive URL query params", () => {
    const result = sanitizeData({
      url: "https://example.com/search?q=puppies&page=2",
    });
    expect(result!.url).toBe("https://example.com/search?q=puppies&page=2");
  });

  test("strips only auth-related query params from URLs", () => {
    const result = sanitizeData({
      url: "https://example.com/api?token=secret123&q=test",
    });
    expect(result!.url).toContain("q=test");
    expect(result!.url).not.toContain("token=");
    expect(result!.url).not.toContain("secret123");
  });

  test("serializes Error objects with message, name, stack", () => {
    const err = new Error("something broke");
    const result = sanitizeData({ error: err });

    expect(result!.error).toBeDefined();
    const serialized = result!.error as Record<string, unknown>;
    expect(serialized.message).toBe("something broke");
    expect(serialized.name).toBe("Error");
    expect(serialized.stack).toContain("something broke");
  });

  test("custom Error subclass serializes correctly", () => {
    class CustomError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "CustomError";
      }
    }
    const err = new CustomError("custom failure");
    const result = sanitizeData({ error: err });

    const serialized = result!.error as Record<string, unknown>;
    expect(serialized.name).toBe("CustomError");
    expect(serialized.message).toBe("custom failure");
    expect(serialized.stack).toBeDefined();
  });

  test("recursively sanitizes nested objects", () => {
    const result = sanitizeData({
      context: { apiKey: "secret", value: "safe" },
    });

    const nested = result!.context as Record<string, unknown>;
    expect(nested.apiKey).toBe("[REDACTED]");
    expect(nested.value).toBe("safe");
  });

  test("passes through plain data unmodified", () => {
    const result = sanitizeData({
      count: 5,
      name: "test",
      nested: { a: 1, b: "two" },
    });

    expect(result!.count).toBe(5);
    expect(result!.name).toBe("test");
    const nested = result!.nested as Record<string, unknown>;
    expect(nested.a).toBe(1);
    expect(nested.b).toBe("two");
  });

  test("does not strip non-URL strings", () => {
    const result = sanitizeData({ message: "just a normal string" });
    expect(result!.message).toBe("just a normal string");
  });
});
