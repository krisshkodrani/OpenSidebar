/**
 * GBrain MCP Client — connects to GBrain as a long-lived subprocess.
 *
 * Spawns the GBrain MCP server (bun) and communicates via stdio transport.
 * Provides typed wrappers for memory operations (put_page, query, etc.).
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { randomUUID } from "crypto";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { stringify as stringifyYaml } from "yaml";
import type {
  BackendConfig,
  MemoryCategory,
  MemoryInput,
  MemoryListResult,
  MemoryMetadata,
  MemoryResult,
} from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_HOME = resolve(__dirname, "..", "data", "backend-home");

let client: Client | null = null;
let transport: StdioClientTransport | null = null;
let connected = false;

// ── Connection lifecycle ──

export async function connectGBrain(
  config: BackendConfig["gbrain"],
  projectRoot: string,
): Promise<void> {
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
    // Isolate agent brain from lab brain via separate HOME directory.
    // GBrain reads ~/.gbrain/config.json, so different HOME = different database.
    HOME: BACKEND_HOME,
    USERPROFILE: BACKEND_HOME,
  };

  transport = new StdioClientTransport({
    command: config.mcpCommand,
    args: config.mcpArgs,
    cwd: projectRoot,
    env,
  });

  client = new Client(
    { name: "opensidebar-backend", version: "1.0.0" },
    { capabilities: {} },
  );

  await client.connect(transport);
  connected = true;
}

export function disconnectGBrain(): void {
  if (transport) {
    try {
      transport.close();
    } catch {
      // ignore close errors
    }
  }
  client = null;
  transport = null;
  connected = false;
}

export function isGBrainConnected(): boolean {
  return connected;
}

// ── Tool call helper ──

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (!client || !connected) throw new Error("GBrain not connected");

  const result = await client.callTool({ name, arguments: args });

  // MCP tool results have content array — extract text
  if (result.content && Array.isArray(result.content)) {
    const textParts = result.content
      .filter((c: { type: string }) => c.type === "text")
      .map((c: { text: string }) => c.text);
    const text = textParts.join("");
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return result;
}

// ── Memory operations ──

function generateSlug(category: MemoryCategory): string {
  const hash = randomUUID().slice(0, 8);
  return `agent-mem-${category}-${hash}`;
}

export function buildPageContent(input: MemoryInput): string {
  const tags = ["agent-memory", input.category];
  if (input.workspaceId) tags.push(`workspace-${input.workspaceId}`);
  if (input.metadata?.domain) tags.push(`domain-${input.metadata.domain}`);

  const frontmatter = stringifyYaml({
    type: "concept",
    title: input.title,
    tags,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  }).trimEnd();

  return `---\n${frontmatter}\n---\n${input.content}`;
}

export async function putMemory(input: MemoryInput): Promise<string> {
  const slug = generateSlug(input.category);
  const content = buildPageContent(input);

  await callTool("put_page", { slug, content });

  return slug;
}

export async function searchMemory(query: string, limit = 5): Promise<MemoryResult[]> {
  const results = (await callTool("query", { query, limit })) as Array<{
    slug: string;
    title: string;
    chunk_text: string;
    score: number;
  }>;

  if (!Array.isArray(results)) return [];

  return results
    .filter((r) => r.slug.startsWith("agent-mem-"))
    .map((r) => {
      const embedded = extractEmbeddedMetadata(r.chunk_text);
      return {
        slug: r.slug,
        title: r.title || r.slug,
        category: extractCategory(r.slug),
        content: embedded.content,
        score: r.score,
        metadata: embedded.metadata,
      };
    });
}

type GBrainPage = {
  slug: string;
  title: string;
  compiled_truth: string;
  frontmatter?: Record<string, unknown>;
};

export function getMemoryMetadata(
  frontmatter?: Record<string, unknown>,
): MemoryMetadata | undefined {
  const metadata = frontmatter?.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return undefined;
  }
  return metadata as MemoryMetadata;
}

export function extractEmbeddedMetadata(content: string): {
  content: string;
  metadata?: MemoryMetadata;
} {
  const match = content.match(/\nMetadata:\s*(\{[\s\S]*\})\s*$/);
  if (!match) {
    return { content };
  }
  try {
    return {
      content: content.slice(0, match.index).trimEnd(),
      metadata: JSON.parse(match[1]) as MemoryMetadata,
    };
  } catch {
    return { content };
  }
}

export async function getMemory(slug: string): Promise<MemoryResult | null> {
  const result = (await callTool("get_page", { slug })) as GBrainPage | null;

  if (!result) return null;
  const embedded = extractEmbeddedMetadata(result.compiled_truth || "");

  return {
    slug: result.slug,
    title: result.title || result.slug,
    category: extractCategory(result.slug),
    content: embedded.content,
    score: 1,
    metadata: getMemoryMetadata(result.frontmatter) ?? embedded.metadata,
  };
}

export async function listMemories(
  category?: string,
  limit = 20,
): Promise<MemoryListResult[]> {
  const args: Record<string, unknown> = { tag: "agent-memory", limit };
  if (category) {
    args.tag = category;
  }

  const results = (await callTool("list_pages", args)) as Array<{
    slug: string;
    title: string;
    type: string;
  }>;

  if (!Array.isArray(results)) return [];

  return results
    .filter((r) => r.slug.startsWith("agent-mem-"))
    .map((r) => ({
      slug: r.slug,
      title: r.title || r.slug,
      type: r.type,
    }));
}

export async function deleteMemory(slug: string): Promise<void> {
  await callTool("delete_page", { slug });
}

export async function addMemoryTimeline(
  slug: string,
  date: string,
  summary: string,
): Promise<void> {
  await callTool("add_timeline_entry", { slug, date, summary });
}

export async function getGBrainStats(): Promise<Record<string, number> | null> {
  try {
    const stats = (await callTool("get_stats", {})) as Record<string, number>;
    return stats;
  } catch {
    return null;
  }
}

// ── Helpers ──

function extractCategory(slug: string): MemoryCategory {
  // agent-mem-{category}-{hash}
  const match = slug.match(/^agent-mem-(.+)-[a-f0-9]{8}$/);
  if (match) {
    const cat = match[1] as MemoryCategory;
    const valid: MemoryCategory[] = ["execution-result", "user-preference", "site-knowledge", "learned-pattern"];
    if (valid.includes(cat)) return cat;
  }
  return "execution-result";
}
