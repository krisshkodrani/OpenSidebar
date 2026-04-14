import { describe, expect, test } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  buildPageContent,
  extractEmbeddedMetadata,
  getMemoryMetadata,
} from "../../backend/gbrain-client";

describe("buildPageContent", () => {
  test("stores memory metadata in YAML frontmatter", () => {
    const content = buildPageContent({
      category: "site-knowledge",
      title: "example.com: dismiss cookie banner",
      content: "Dismiss the cookie banner before searching.",
      workspaceId: "ws-123",
      metadata: {
        domain: "example.com",
        tipType: "recovery",
        confidence: 0.9,
      },
    });

    expect(content.startsWith("---\n")).toBe(true);
    expect(content).not.toContain("\nMetadata:");

    const parts = content.split("\n---\n");
    const frontmatter = parseYaml(parts[0].replace(/^---\n/, ""));
    expect(frontmatter.tags).toContain("agent-memory");
    expect(frontmatter.tags).toContain("site-knowledge");
    expect(frontmatter.tags).toContain("workspace-ws-123");
    expect(frontmatter.tags).toContain("domain-example.com");
    expect(frontmatter.metadata).toEqual({
      domain: "example.com",
      tipType: "recovery",
      confidence: 0.9,
    });
    expect(parts[1]).toBe("Dismiss the cookie banner before searching.");
  });
});

describe("memory metadata helpers", () => {
  test("extracts structured metadata from frontmatter", () => {
    expect(
      getMemoryMetadata({
        metadata: {
          domain: "example.com",
          tipType: "strategy",
          confidence: 0.8,
        },
      }),
    ).toEqual({
      domain: "example.com",
      tipType: "strategy",
      confidence: 0.8,
    });
  });

  test("falls back to embedded metadata format for legacy records", () => {
    const legacy = extractEmbeddedMetadata(
      "Dismiss the cookie banner.\nMetadata: {\"tipType\":\"recovery\",\"confidence\":0.85}",
    );

    expect(legacy.content).toBe("Dismiss the cookie banner.");
    expect(legacy.metadata).toEqual({
      tipType: "recovery",
      confidence: 0.85,
    });
  });
});
