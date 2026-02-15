import { MemorySearchResult } from "../../types";

const RRF_K = 60;

/**
 * Combines semantic and keyword search results using Reciprocal Rank Fusion.
 * @param semanticResults Results from Voy (id, score)
 * @param keywordResults Results from FTS5 (id, rank)
 * @param limit Max number of results to return
 * @param fetchEntry Callback to retrieve full entry details by ID
 */
export function reciprocalRankFusion(
  semanticResults: Array<{ id: string; score: number }>,
  keywordResults: Array<{ id: string; rank: number }>,
  limit: number,
  fetchEntry: (id: string) => any, // Dependency injection for data retrieval
): MemorySearchResult[] {
  const scores = new Map<
    string,
    { semantic: number; keyword: number; rrf: number }
  >();

  // 1. Rank Semantic
  semanticResults.forEach((res, index) => {
    const rank = index + 1;
    const rrf = 1 / (RRF_K + rank);
    scores.set(res.id, { semantic: res.score, keyword: 0, rrf });
  });

  // 2. Rank Keyword
  keywordResults.forEach((res, index) => {
    const rank = index + 1;
    const rrf = 1 / (RRF_K + rank);

    const existing = scores.get(res.id);
    if (existing) {
      existing.keyword = Math.abs(res.rank);
      existing.rrf += rrf;
    } else {
      scores.set(res.id, { semantic: 0, keyword: Math.abs(res.rank), rrf });
    }
  });

  // 3. Sort by RRF
  const sortedIds = Array.from(scores.entries())
    .sort((a, b) => b[1].rrf - a[1].rrf)
    .slice(0, limit);

  // 4. Hydrate
  return sortedIds.map(([id, scoreData]) => {
    const entry = fetchEntry(id);

    return {
      entry,
      score: scoreData.rrf,
      scores: {
        semantic: scoreData.semantic,
        keyword: scoreData.keyword,
      },
    };
  });
}
