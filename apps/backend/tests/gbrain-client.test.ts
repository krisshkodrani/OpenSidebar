import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, test } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  buildGBrainHomeConfig,
  buildPageContent,
  ensureGBrainHomeConfig,
  extractEmbeddedMetadata,
  getMemoryMetadata,
  resolveCliCommand,
} from "../src/gbrain-client";

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

describe("backend gbrain home config", () => {
  test("builds the isolated backend gbrain config", () => {
    expect(buildGBrainHomeConfig("C:\\temp\\brain.pglite")).toBe(
      '{\n  "engine": "pglite",\n  "database_path": "C:\\\\temp\\\\brain.pglite"\n}',
    );
  });

  test("writes the isolated backend gbrain config to disk", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "opensidebar-backend-home-"));
    const databasePath = join(homeDir, "data", "agent-brain.pglite");

    try {
      ensureGBrainHomeConfig(homeDir, databasePath);

      const configPath = join(homeDir, ".gbrain", "config.json");
      expect(existsSync(configPath)).toBe(true);
      expect(JSON.parse(readFileSync(configPath, "utf-8"))).toEqual({
        engine: "pglite",
        database_path: databasePath,
      });
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  test("builds the backend home config for the configured database path", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "opensidebar-backend-home-"));
    const databasePath = join(homeDir, "data", "agent-brain.pglite");

    try {
      ensureGBrainHomeConfig(homeDir, databasePath);
      const configPath = join(homeDir, ".gbrain", "config.json");
      const parsed = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(parsed.database_path).toBe(databasePath);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});

describe("resolveCliCommand", () => {
  test("keeps non-bun commands unchanged", () => {
    expect(resolveCliCommand("node")).toBe("node");
  });

  test("resolves bun to bun.exe on Windows when installed", () => {
    if (process.platform !== "win32" || !process.env.APPDATA) {
      expect(resolveCliCommand("bun")).toBe("bun");
      return;
    }

    expect(resolveCliCommand("bun").endsWith("bun.exe")).toBe(true);
  });
});
