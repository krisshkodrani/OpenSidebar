import { openDB, DBSchema, IDBPDatabase } from "idb";
import { pipeline, FeatureExtractionPipeline } from "@xenova/transformers";
import { MemoryEntry, MemorySearchResult } from "../../types";
import { logger } from "../../utils";

interface MemoryDB extends DBSchema {
  memories: {
    key: string;
    value: MemoryEntry;
    indexes: { "by-category": string };
  };
}

export class VectorStore {
  private dbPromise: Promise<IDBPDatabase<MemoryDB>>;
  private embedder: FeatureExtractionPipeline | null = null;
  private modelName = "Xenova/all-MiniLM-L6-v2";

  constructor() {
    this.dbPromise = openDB<MemoryDB>("qsidebar-memory", 1, {
      upgrade(db) {
        const store = db.createObjectStore("memories", { keyPath: "id" });
        store.createIndex("by-category", "category");
      },
    });
  }

  async init() {
    try {
      logger.info("memory", "Loading embedding model...");
      this.embedder = await pipeline("feature-extraction", this.modelName);
      logger.info("memory", "Embedding model loaded");
    } catch (e) {
      logger.error("memory", "Failed to load model", { error: e });
    }
  }

  async add(
    content: string,
    category: string,
    sourceUrl: string,
  ): Promise<string> {
    if (!this.embedder) await this.init();
    if (!this.embedder) throw new Error("Embedder not initialized");

    const output = await this.embedder(content, {
      pooling: "mean",
      normalize: true,
    });
    const embedding = output.data as Float32Array; // Xenova returns Tensor, .data is the array

    const entry: MemoryEntry = {
      id: crypto.randomUUID(),
      content,
      embedding: embedding, // Type mismatch? Float32Array vs Float32Array. Should be fine.
      category,
      sourceUrl,
      createdAt: Date.now(),
    };

    const db = await this.dbPromise;
    await db.put("memories", entry);
    return entry.id;
  }

  async search(
    query: string,
    limit: number = 5,
  ): Promise<MemorySearchResult[]> {
    if (!this.embedder) await this.init();
    if (!this.embedder) throw new Error("Embedder not initialized");

    // 1. Embed Query
    const output = await this.embedder(query, {
      pooling: "mean",
      normalize: true,
    });
    const queryEmbedding = output.data as Float32Array;

    // 2. Verified: Brute-force Cosine Similarity
    // Fetch all items (for MVP < 1000 items, this is < 10ms)
    const db = await this.dbPromise;
    const allMemories = await db.getAll("memories");

    const results: MemorySearchResult[] = allMemories.map((entry) => {
      const score = this.cosineSimilarity(queryEmbedding, entry.embedding);
      return {
        entry,
        score,
        scores: { semantic: score, keyword: 0 }, // keyword placeholder
      };
    });

    // 3. Sort and Slice
    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  private cosineSimilarity(
    a: Float32Array | any,
    b: Float32Array | any,
  ): number {
    // Safety checks
    if (!a || !b) return 0;
    if (a.length !== b.length) {
      logger.warn("memory", "Embedding length mismatch", {
        lenA: a.length,
        lenB: b.length,
      });
      return 0;
    }

    // Xenova might return standard Arrays or Float32Arrays depending on version/config
    // Assuming strict Float32Array or coercible
    let dotProduct = 0.0;
    let normA = 0.0;
    let normB = 0.0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
