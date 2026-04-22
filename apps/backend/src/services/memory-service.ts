/**
 * Memory Service — native SQLite-backed memory operations.
 */

import { randomUUID } from "node:crypto";
import { getDatabase } from "../db.js";
import type {
  MemoryCategory,
  MemoryInput,
  MemoryListResult,
  MemoryMetadata,
  MemoryResult,
} from "../types.js";

type MemoryRow = {
  id: string;
  category: MemoryCategory;
  title: string;
  content: string;
  metadata_json: string | null;
  updated_at: number;
  rank?: number;
};

export function isMemoryAvailable(): boolean {
  return true;
}

export function getMemoryStats(): { pageCount: number } {
  const db = getDatabase();
  const row = db
    .prepare("SELECT COUNT(*) as count FROM memory_entries")
    .get() as { count: number };
  return { pageCount: row.count };
}

export async function createMemory(
  input: MemoryInput,
): Promise<{ id: string; slug: string }> {
  const db = getDatabase();
  const id = randomUUID();
  const now = Date.now();
  const metadata = normalizeMetadata(input.metadata);
  const domain = extractDomain(metadata);

  db.prepare(
    `
      INSERT INTO memory_entries (
        id, workspace_id, domain, category, title, content, metadata_json, created_at, updated_at, last_accessed_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    id,
    input.workspaceId ?? null,
    domain,
    input.category,
    input.title,
    input.content,
    metadata ? JSON.stringify(metadata) : null,
    now,
    now,
    now,
  );

  return { id, slug: id };
}

export async function queryMemories(
  query: string,
  limit = 5,
): Promise<MemoryResult[]> {
  const db = getDatabase();
  const sanitizedQuery = buildFtsQuery(query);
  if (!sanitizedQuery) return [];

  const rows = db
    .prepare(
      `
        SELECT
          e.id,
          e.category,
          e.title,
          e.content,
          e.metadata_json,
          e.updated_at,
          bm25(memory_entries_fts, 1.5, 1.0) AS rank
        FROM memory_entries_fts
        JOIN memory_entries e ON e.rowid = memory_entries_fts.rowid
        WHERE memory_entries_fts MATCH ?
        ORDER BY rank ASC, e.updated_at DESC
        LIMIT ?
      `,
    )
    .all(sanitizedQuery, limit) as MemoryRow[];

  touchMemories(rows.map((row) => row.id));
  return rows.map(toMemoryResult);
}

export async function fetchMemory(id: string): Promise<MemoryResult | null> {
  const db = getDatabase();
  const row = db
    .prepare(
      `
        SELECT id, category, title, content, metadata_json, updated_at
        FROM memory_entries
        WHERE id = ?
      `,
    )
    .get(id) as MemoryRow | undefined;

  if (!row) return null;
  touchMemories([row.id]);
  return toMemoryResult(row);
}

export async function fetchMemoryList(
  category?: string,
  limit = 20,
): Promise<MemoryListResult[]> {
  const db = getDatabase();
  const sql = category
    ? `
        SELECT id, title, category
        FROM memory_entries
        WHERE category = ?
        ORDER BY updated_at DESC
        LIMIT ?
      `
    : `
        SELECT id, title, category
        FROM memory_entries
        ORDER BY updated_at DESC
        LIMIT ?
      `;
  const rows = (category
    ? db.prepare(sql).all(category, limit)
    : db.prepare(sql).all(limit)) as Array<{
    id: string;
    title: string;
    category: MemoryCategory;
  }>;

  return rows.map((row) => ({
    id: row.id,
    slug: row.id,
    title: row.title,
    category: row.category,
    type: row.category,
  }));
}

export async function queryMemoriesByDomain(
  domain: string,
  limit = 10,
): Promise<MemoryResult[]> {
  const db = getDatabase();
  const rows = db
    .prepare(
      `
        SELECT id, category, title, content, metadata_json, updated_at
        FROM memory_entries
        WHERE domain = ?
        ORDER BY updated_at DESC
        LIMIT ?
      `,
    )
    .all(domain, limit) as MemoryRow[];

  touchMemories(rows.map((row) => row.id));
  return rows.map((row) => ({
    ...toMemoryResult(row),
    score: 1,
  }));
}

export async function removeMemory(id: string): Promise<void> {
  const db = getDatabase();
  db.prepare("DELETE FROM memory_entries WHERE id = ?").run(id);
}

/**
 * Format memories for injection into planner prompt.
 */
export function formatMemoriesForPrompt(memories: MemoryResult[]): string {
  if (memories.length === 0) return "";

  const sections = ["LONG-TERM MEMORY (relevant past experiences):"];
  for (const mem of memories) {
    sections.push(
      "",
      `[${mem.category}] ${mem.title}`,
      mem.content.length > 300
        ? mem.content.slice(0, 300).trimEnd() + "..."
        : mem.content,
    );
  }
  return sections.join("\n");
}

function normalizeMetadata(
  metadata: MemoryMetadata | undefined,
): MemoryMetadata | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  return metadata;
}

function extractDomain(metadata: MemoryMetadata | undefined): string | null {
  const raw = metadata?.domain;
  return typeof raw === "string" && raw.trim() ? raw.trim().toLowerCase() : null;
}

function buildFtsQuery(query: string): string {
  const tokens = query
    .replace(/["']/g, " ")
    .replace(/[^\p{L}\p{N}\s_-]+/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  return tokens.join(" ");
}

function touchMemories(ids: string[]): void {
  if (ids.length === 0) return;
  const db = getDatabase();
  const now = Date.now();
  const update = db.prepare(
    "UPDATE memory_entries SET last_accessed_at = ? WHERE id = ?",
  );
  const tx = db.transaction((memoryIds: string[]) => {
    for (const id of memoryIds) update.run(now, id);
  });
  tx(ids);
}

function toMemoryResult(row: MemoryRow): MemoryResult {
  return {
    id: row.id,
    slug: row.id,
    title: row.title,
    category: row.category,
    content: row.content,
    score: rankToScore(row.rank),
    metadata: parseMetadata(row.metadata_json),
  };
}

function rankToScore(rank: number | undefined): number {
  if (typeof rank !== "number" || Number.isNaN(rank)) return 1;
  const normalized = Math.max(rank, 0);
  return Number((1 / (1 + normalized)).toFixed(4));
}

function parseMetadata(raw: string | null): MemoryMetadata | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as MemoryMetadata;
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}
