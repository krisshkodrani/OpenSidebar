/**
 * GBrain MCP Client — connects to GBrain as a long-lived subprocess.
 *
 * Spawns the GBrain MCP server (bun) and communicates via stdio transport.
 * Provides typed wrappers for memory operations (put_page, query, etc.).
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawnSync } from "child_process";
import { randomUUID } from "crypto";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
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
const MCP_CALL_TIMEOUT_MS = 15_000;

let client: Client | null = null;
let transport: StdioClientTransport | null = null;
let connected = false;
let connectedConfig: BackendConfig["gbrain"] | null = null;
let connectedProjectRoot: string | null = null;

export function buildGBrainHomeConfig(databasePath: string): string {
  return JSON.stringify(
    {
      engine: "pglite",
      database_path: databasePath,
    },
    null,
    2,
  );
}

export function resolveCliCommand(command: string): string {
  if (process.platform !== "win32" || command !== "bun") {
    return command;
  }

  const appData = process.env.APPDATA;
  if (!appData) {
    return command;
  }

  const bunExe = resolve(appData, "npm", "node_modules", "bun", "bin", "bun.exe");
  return existsSync(bunExe) ? bunExe : command;
}

export function ensureGBrainHomeConfig(
  homeDir: string,
  databasePath: string,
): void {
  const configDir = resolve(homeDir, ".gbrain");
  mkdirSync(configDir, { recursive: true });
  mkdirSync(dirname(databasePath), { recursive: true });
  writeFileSync(
    resolve(configDir, "config.json"),
    buildGBrainHomeConfig(databasePath),
    "utf-8",
  );
}

export function ensureGBrainDatabaseInitialized(
  config: BackendConfig["gbrain"],
  projectRoot: string,
): void {
  const initArgs = [
    "run",
    "path/to/gbrain-cli.ts",
    "init",
    "--pglite",
    "--path",
    config.databasePath,
  ];

  const result = spawnSync(resolveCliCommand(config.mcpCommand), initArgs, {
    cwd: projectRoot,
    env: {
      ...process.env,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
      HOME: BACKEND_HOME,
      USERPROFILE: BACKEND_HOME,
    },
    stdio: "pipe",
    encoding: "utf-8",
  });

  if ((result.status ?? 1) !== 0) {
    const detail = (result.stderr || result.stdout || "unknown error").trim();
    throw new Error(`Failed to initialize backend GBrain database: ${detail}`);
  }
}

// ── Connection lifecycle ──

export async function connectGBrain(
  config: BackendConfig["gbrain"],
  projectRoot: string,
): Promise<void> {
  ensureGBrainHomeConfig(BACKEND_HOME, config.databasePath);
  ensureGBrainDatabaseInitialized(config, projectRoot);

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
    // Isolate backend memory state into a project-local HOME directory.
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
  connectedConfig = config;
  connectedProjectRoot = projectRoot;
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
  connectedConfig = null;
  connectedProjectRoot = null;
}

export function isGBrainConnected(): boolean {
  return connected;
}

// ── Tool call helper ──

function callToolViaCli(
  name: string,
  args: Record<string, unknown>,
): unknown {
  if (!connectedConfig || !connectedProjectRoot) {
    throw new Error("GBrain connection context unavailable");
  }

  const result = spawnSync(
    resolveCliCommand(connectedConfig.mcpCommand),
    [
      "run",
      "path/to/gbrain-cli.ts",
      "call",
      name,
      JSON.stringify(args),
    ],
    {
      cwd: connectedProjectRoot,
      env: {
        ...process.env,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
        HOME: BACKEND_HOME,
        USERPROFILE: BACKEND_HOME,
      },
      stdio: "pipe",
      encoding: "utf-8",
    },
  );

  if ((result.status ?? 1) !== 0) {
    const detail = (result.stderr || result.stdout || "unknown error").trim();
    throw new Error(detail);
  }

  const stdout = (result.stdout || "").trim();
  if (!stdout) return null;
  return JSON.parse(stdout);
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (!connected) throw new Error("GBrain not connected");
  if (!client) {
    return callToolViaCli(name, args);
  }

  let result: Awaited<ReturnType<Client["callTool"]>>;
  try {
    result = await Promise.race([
      client.callTool({ name, arguments: args }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timed out calling ${name}`)), MCP_CALL_TIMEOUT_MS),
      ),
    ]);
  } catch {
    return callToolViaCli(name, args);
  }

  // MCP tool results have content array — extract text
  if (
    typeof result === "object" &&
    result !== null &&
    "content" in result &&
    Array.isArray(result.content)
  ) {
    const textParts = result.content
      .filter(
        (c): c is { type: string; text: string } =>
          typeof c === "object" &&
          c !== null &&
          "type" in c &&
          c.type === "text" &&
          "text" in c &&
          typeof c.text === "string",
      )
      .map((c) => c.text);
    const text = textParts.join("");
    if ("isError" in result && result.isError) {
      try {
        const parsed = JSON.parse(text) as {
          message?: string;
          error?: string;
          code?: string;
        };
        throw new Error(parsed.message || parsed.error || parsed.code || text);
      } catch (parseError) {
        if (parseError instanceof Error && parseError.message !== text) {
          throw parseError;
        }
        throw new Error(text);
      }
    }
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

function buildPageDocument(slug: string, input: MemoryInput): string {
  const tags = ["agent-memory", input.category];
  if (input.workspaceId) tags.push(`workspace-${input.workspaceId}`);
  if (input.metadata?.domain) tags.push(`domain-${input.metadata.domain}`);

  const frontmatter = stringifyYaml({
    slug,
    type: "concept",
    title: input.title,
    tags,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  }).trimEnd();

  return `---\n${frontmatter}\n---\n${input.content}`;
}

function importMemoryWithoutEmbedding(
  slug: string,
  input: MemoryInput,
): void {
  if (!connectedConfig || !connectedProjectRoot) {
    throw new Error("GBrain connection context unavailable");
  }

  const tempDir = mkdtempSync(resolve(tmpdir(), "opensidebar-backend-memory-"));
  const filePath = resolve(tempDir, "memory.md");

  try {
    writeFileSync(filePath, buildPageDocument(slug, input), "utf-8");

    const result = spawnSync(
      resolveCliCommand(connectedConfig.mcpCommand),
      [
        "run",
        "path/to/gbrain-cli.ts",
        "import",
        tempDir,
        "--no-embed",
      ],
      {
        cwd: connectedProjectRoot,
        env: {
          ...process.env,
          OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
          HOME: BACKEND_HOME,
          USERPROFILE: BACKEND_HOME,
        },
        stdio: "pipe",
        encoding: "utf-8",
      },
    );

    if ((result.status ?? 1) !== 0) {
      const detail = (result.stderr || result.stdout || "unknown error").trim();
      throw new Error(`Failed to import backend memory: ${detail}`);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export async function putMemory(input: MemoryInput): Promise<string> {
  const slug = generateSlug(input.category);
  importMemoryWithoutEmbedding(slug, input);

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
