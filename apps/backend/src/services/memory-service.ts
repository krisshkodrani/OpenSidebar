/**
 * Memory Service — business logic for memory operations via GBrain.
 */

import {
  putMemory,
  searchMemory,
  getMemory,
  listMemories,
  deleteMemory,
  addMemoryTimeline,
  isGBrainConnected,
} from "../gbrain-client.js";
import type { MemoryInput, MemoryResult, MemoryListResult } from "../types.js";

export async function createMemory(input: MemoryInput): Promise<{ slug: string }> {
  if (!isGBrainConnected()) {
    throw new Error("GBrain not connected — memory unavailable");
  }

  const slug = await putMemory(input);

  // Add timeline entry for the creation event
  const now = new Date().toISOString().slice(0, 10);
  await addMemoryTimeline(slug, now, `Created: ${input.title}`).catch(() => {});

  return { slug };
}

export async function queryMemories(
  query: string,
  limit = 5,
): Promise<MemoryResult[]> {
  if (!isGBrainConnected()) return [];
  return searchMemory(query, limit);
}

export async function fetchMemory(slug: string): Promise<MemoryResult | null> {
  if (!isGBrainConnected()) return null;
  return getMemory(slug);
}

export async function fetchMemoryList(
  category?: string,
  limit = 20,
): Promise<MemoryListResult[]> {
  if (!isGBrainConnected()) return [];
  return listMemories(category, limit);
}

export async function queryMemoriesByDomain(
  domain: string,
  limit = 10,
): Promise<MemoryResult[]> {
  if (!isGBrainConnected()) return [];

  // Use GBrain's tag-based listing to find domain-specific memories
  const list = await listMemories(`domain-${domain}`, limit);
  if (list.length === 0) return [];

  // Fetch details in parallel so prompt injection stays within the extension timeout budget.
  const details = await Promise.all(
    list.map((item) => getMemory(item.slug).catch(() => null)),
  );
  return details.filter((detail): detail is MemoryResult => detail !== null);
}

export async function removeMemory(slug: string): Promise<void> {
  if (!isGBrainConnected()) {
    throw new Error("GBrain not connected — memory unavailable");
  }
  await deleteMemory(slug);
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
      mem.content.length > 300 ? mem.content.slice(0, 300).trimEnd() + "..." : mem.content,
    );
  }
  return sections.join("\n");
}
