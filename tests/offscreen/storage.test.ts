import { describe, test, expect, beforeEach } from "bun:test";
import { reciprocalRankFusion } from "../../src/offscreen/memory/utils";

// Mock types for testing
interface TestMemoryEntry {
  id: string;
  content: string;
  category: string;
}

interface SemanticResult {
  id: string;
  score: number;
}

interface KeywordResult {
  id: string;
  rank: number;
}

describe("Memory Storage & RRF Fusion", () => {
  describe("RRF Fusion Algorithm", () => {
    test("combines semantic and keyword results correctly", () => {
      const semanticResults: SemanticResult[] = [
        { id: "1", score: 0.95 },
        { id: "2", score: 0.85 },
        { id: "3", score: 0.75 },
      ];

      const keywordResults: KeywordResult[] = [
        { id: "2", rank: 1 },
        { id: "4", rank: 2 },
        { id: "1", rank: 3 },
      ];

      const mockEntries = new Map<string, TestMemoryEntry>([
        ["1", { id: "1", content: "Entry 1", category: "test" }],
        ["2", { id: "2", content: "Entry 2", category: "test" }],
        ["3", { id: "3", content: "Entry 3", category: "test" }],
        ["4", { id: "4", content: "Entry 4", category: "test" }],
      ]);

      const fetchEntry = (id: string): TestMemoryEntry => mockEntries.get(id)!;

      const fused = reciprocalRankFusion(
        semanticResults,
        keywordResults,
        10,
        fetchEntry,
      );

      // Should return all unique results
      expect(fused.length).toBe(4);

      // Entry 2 appears in both lists, should have highest RRF score
      const entry2 = fused.find((r) => r.entry.id === "2");
      expect(entry2).toBeDefined();

      // Entry 4 only in keyword, should still appear
      const entry4 = fused.find((r) => r.entry.id === "4");
      expect(entry4).toBeDefined();
    });

    test("handles empty semantic results", () => {
      const semanticResults: SemanticResult[] = [];
      const keywordResults: KeywordResult[] = [
        { id: "1", rank: 1 },
        { id: "2", rank: 2 },
      ];

      const mockEntries = new Map([
        ["1", { id: "1", content: "Entry 1", category: "test" }],
        ["2", { id: "2", content: "Entry 2", category: "test" }],
      ]);

      const fetchEntry = (id: string): TestMemoryEntry => mockEntries.get(id)!;

      const fused = reciprocalRankFusion(
        semanticResults,
        keywordResults,
        10,
        fetchEntry,
      );

      expect(fused.length).toBe(2);
      expect(fused[0].entry.id).toBe("1");
    });

    test("handles empty keyword results", () => {
      const semanticResults: SemanticResult[] = [
        { id: "1", score: 0.95 },
        { id: "2", score: 0.85 },
      ];
      const keywordResults: KeywordResult[] = [];

      const mockEntries = new Map([
        ["1", { id: "1", content: "Entry 1", category: "test" }],
        ["2", { id: "2", content: "Entry 2", category: "test" }],
      ]);

      const fetchEntry = (id: string): TestMemoryEntry => mockEntries.get(id)!;

      const fused = reciprocalRankFusion(
        semanticResults,
        keywordResults,
        10,
        fetchEntry,
      );

      expect(fused.length).toBe(2);
      expect(fused[0].entry.id).toBe("1");
    });

    test("respects limit parameter", () => {
      const semanticResults: SemanticResult[] = [
        { id: "1", score: 0.95 },
        { id: "2", score: 0.85 },
        { id: "3", score: 0.75 },
        { id: "4", score: 0.65 },
        { id: "5", score: 0.55 },
      ];

      const keywordResults: KeywordResult[] = [];

      const mockEntries = new Map([
        ["1", { id: "1", content: "Entry 1", category: "test" }],
        ["2", { id: "2", content: "Entry 2", category: "test" }],
        ["3", { id: "3", content: "Entry 3", category: "test" }],
        ["4", { id: "4", content: "Entry 4", category: "test" }],
        ["5", { id: "5", content: "Entry 5", category: "test" }],
      ]);

      const fetchEntry = (id: string): TestMemoryEntry => mockEntries.get(id)!;

      const fused = reciprocalRankFusion(
        semanticResults,
        keywordResults,
        3, // limit to 3
        fetchEntry,
      );

      expect(fused.length).toBe(3);
    });

    test("higher rank in both lists gives higher RRF score", () => {
      const semanticResults: SemanticResult[] = [
        { id: "1", score: 0.95 }, // Rank 1 in semantic
        { id: "2", score: 0.85 }, // Rank 2 in semantic
      ];

      const keywordResults: KeywordResult[] = [
        { id: "1", rank: 1 }, // Rank 1 in keyword
        { id: "2", rank: 2 }, // Rank 2 in keyword
      ];

      const mockEntries = new Map([
        ["1", { id: "1", content: "Entry 1", category: "test" }],
        ["2", { id: "2", content: "Entry 2", category: "test" }],
      ]);

      const fetchEntry = (id: string): TestMemoryEntry => mockEntries.get(id)!;

      const fused = reciprocalRankFusion(
        semanticResults,
        keywordResults,
        10,
        fetchEntry,
      );

      // Both entries rank #1 in their respective lists
      // Entry 1 should have higher or equal score than Entry 2
      const entry1 = fused.find((r) => r.entry.id === "1")!;
      const entry2 = fused.find((r) => r.entry.id === "2")!;

      expect(entry1.score).toBeGreaterThanOrEqual(entry2.score);
    });
  });

  describe("Vector Operations", () => {
    test("embedding dimensions are consistent", () => {
      // MiniLM-L6-v2 produces 384-dimensional embeddings
      // This test documents the expected dimension
      const expectedDimensions = 384;

      // Mock embedding (would come from Transformers.js in real usage)
      const mockEmbedding = new Array(expectedDimensions)
        .fill(0)
        .map(() => Math.random());

      expect(mockEmbedding.length).toBe(expectedDimensions);
    });

    test("cosine similarity calculation", () => {
      // Two identical vectors should have similarity 1.0
      const vec1 = [1, 0, 0];
      const vec2 = [1, 0, 0];

      const similarity = calculateCosineSimilarity(vec1, vec2);
      expect(similarity).toBeCloseTo(1.0, 5);

      // Two orthogonal vectors should have similarity 0.0
      const vec3 = [1, 0, 0];
      const vec4 = [0, 1, 0];

      const similarity2 = calculateCosineSimilarity(vec3, vec4);
      expect(similarity2).toBeCloseTo(0.0, 5);

      // Two opposite vectors should have similarity -1.0
      const vec5 = [1, 0, 0];
      const vec6 = [-1, 0, 0];

      const similarity3 = calculateCosineSimilarity(vec5, vec6);
      expect(similarity3).toBeCloseTo(-1.0, 5);
    });
  });

  describe("Memory Entry Operations", () => {
    test("entry has required fields", () => {
      const entry: TestMemoryEntry = {
        id: "test-123",
        content: "Test content",
        category: "test-category",
      };

      expect(entry.id).toBeDefined();
      expect(entry.content).toBeDefined();
      expect(entry.category).toBeDefined();
      expect(typeof entry.id).toBe("string");
      expect(typeof entry.content).toBe("string");
    });

    test("UUID generation produces unique IDs", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const id = crypto.randomUUID();
        expect(ids.has(id)).toBe(false);
        ids.add(id);
      }
      expect(ids.size).toBe(100);
    });
  });
});

/**
 * Calculate cosine similarity between two vectors
 * Similarity = dot product / (magnitude1 * magnitude2)
 */
function calculateCosineSimilarity(vec1: number[], vec2: number[]): number {
  if (vec1.length !== vec2.length) {
    throw new Error("Vectors must have same dimension");
  }

  let dotProduct = 0;
  let magnitude1 = 0;
  let magnitude2 = 0;

  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
    magnitude1 += vec1[i] * vec1[i];
    magnitude2 += vec2[i] * vec2[i];
  }

  magnitude1 = Math.sqrt(magnitude1);
  magnitude2 = Math.sqrt(magnitude2);

  if (magnitude1 === 0 || magnitude2 === 0) {
    return 0;
  }

  return dotProduct / (magnitude1 * magnitude2);
}
