/**
 * Mock Memory Bridge
 *
 * Simulates the memory system for evaluations without requiring
 * the full offscreen document, SQLite, and Voy setup.
 */

import type { MemoryEntry, MemorySearchResult } from "../../src/types/index.js";

export interface MockMemoryEntry {
  id: string;
  content: string;
  category: string;
  sourceUrl: string;
  createdAt: number;
}

/**
 * Simple mock memory system for evaluations
 */
export class MockMemoryBridge {
  private memories: Map<string, MockMemoryEntry> = new Map();

  constructor(initialData: MockMemoryEntry[] = []) {
    initialData.forEach((m) => this.memories.set(m.id, m));
  }

  /**
   * Search memories by query (simple keyword matching)
   */
  async search(
    query: string,
    limit: number = 5,
  ): Promise<MemorySearchResult[]> {
    const queryLower = query.toLowerCase();
    const results: MemorySearchResult[] = [];

    for (const [id, entry] of this.memories) {
      const score = this.calculateRelevance(queryLower, entry);
      if (score > 0) {
        results.push({
          entry: {
            id: entry.id,
            content: entry.content,
            category: entry.category,
            sourceUrl: entry.sourceUrl,
            createdAt: entry.createdAt,
            embedding: new Float32Array(0), // Mock embedding
          },
          score,
          scores: {
            semantic: score,
            keyword: score,
          },
        });
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /**
   * Add a new memory entry
   */
  async add(
    content: string,
    category: string,
    sourceUrl: string,
  ): Promise<string> {
    const id = `mem-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.memories.set(id, {
      id,
      content,
      category,
      sourceUrl,
      createdAt: Date.now(),
    });
    return id;
  }

  /**
   * Get all memories (for debugging)
   */
  getAllMemories(): MockMemoryEntry[] {
    return Array.from(this.memories.values());
  }

  /**
   * Clear all memories
   */
  clear(): void {
    this.memories.clear();
  }

  /**
   * Calculate relevance score (0-1) between query and entry
   */
  private calculateRelevance(query: string, entry: MockMemoryEntry): number {
    const contentLower = entry.content.toLowerCase();
    const categoryLower = entry.category.toLowerCase();

    let score = 0;
    const queryWords = query.split(/\s+/).filter((w) => w.length > 2);

    queryWords.forEach((word) => {
      // Content matching (higher weight)
      if (contentLower.includes(word)) {
        score += 0.25;
        // Boost for exact phrase match
        if (contentLower.includes(query)) {
          score += 0.3;
        }
      }

      // Category matching
      if (categoryLower.includes(word)) {
        score += 0.2;
      }
    });

    // Normalize score
    return Math.min(score, 1.0);
  }
}

/**
 * Create mock memory entries from golden case data
 */
export function createMockMemoryFromData(
  data: MockMemoryEntry[],
): MockMemoryBridge {
  return new MockMemoryBridge(data);
}
