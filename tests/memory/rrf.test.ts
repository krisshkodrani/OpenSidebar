import { describe, test, expect } from "vitest";
import { reciprocalRankFusion } from "../../src/offscreen/memory/utils";

describe("Reciprocal Rank Fusion", () => {

    // Mock fetchEntry to return basic object
    const mockFetch = (id: string) => ({ id, content: "test" });

    test("correctly fuses semantic and keyword results", () => {
        const semantic = [
            { id: "A", score: 0.9 }, // Rank 1
            { id: "B", score: 0.8 }, // Rank 2
        ];

        const keyword = [
            { id: "B", rank: -5 },   // Rank 1
            { id: "C", rank: -3 },   // Rank 2
        ];

        // RRF constant K = 60
        // Score A: 1/(60+1) = 0.01639
        // Score B: 1/(60+2) + 1/(60+1) = 0.01612 + 0.01639 = 0.03251 (Winner)
        // Score C: 1/(60+2) = 0.01612

        const results = reciprocalRankFusion(semantic, keyword, 3, mockFetch);

        expect(results.length).toBe(3);
        expect(results[0].entry.id).toBe("B"); // B should be first because it is in both
        expect(results[1].entry.id).toBe("A");
        expect(results[2].entry.id).toBe("C");
    });

    test("respects limit", () => {
        const semantic = [
            { id: "A", score: 0.9 },
            { id: "B", score: 0.8 },
            { id: "C", score: 0.7 },
        ];
        const keyword = [];

        const results = reciprocalRankFusion(semantic, keyword, 2, mockFetch);
        expect(results.length).toBe(2);
        expect(results[0].entry.id).toBe("A");
        expect(results[1].entry.id).toBe("B");
    });

    test("handles empty input", () => {
        const results = reciprocalRankFusion([], [], 5, mockFetch);
        expect(results.length).toBe(0);
    });
});
