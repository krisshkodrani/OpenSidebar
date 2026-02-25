import { describe, it, expect } from "vitest";
import { extractJsonObjects, recoverToolCallsFromText } from "../../src/background/agent/tool-recovery";

describe("extractJsonObjects", () => {
    it("extracts a single JSON object", () => {
        const result = extractJsonObjects('{"a":1}');
        expect(result).toEqual([{ a: 1 }]);
    });

    it("extracts multiple concatenated objects", () => {
        const result = extractJsonObjects('{"a":1}{"b":2}');
        expect(result).toEqual([{ a: 1 }, { b: 2 }]);
    });

    it("extracts objects with prefix text", () => {
        const result = extractJsonObjects('Approved. Proceed. {"a":1}');
        expect(result).toEqual([{ a: 1 }]);
    });

    it("handles nested braces inside string values", () => {
        const result = extractJsonObjects('{"text": "{\\"key\\":\\"val\\"}"}');
        expect(result).toHaveLength(1);
        expect((result[0] as any).text).toBe('{"key":"val"}');
    });

    it("skips truncated JSON at end", () => {
        const result = extractJsonObjects('{"a":1}{"b":');
        expect(result).toEqual([{ a: 1 }]);
    });

    it("returns empty array for no JSON", () => {
        expect(extractJsonObjects("Just plain text")).toEqual([]);
    });

    it("returns empty array for empty string", () => {
        expect(extractJsonObjects("")).toEqual([]);
    });
});

describe("recoverToolCallsFromText", () => {
    // Test 1: Single call (Pattern A)
    it("recovers a single Pattern A call", () => {
        const result = recoverToolCallsFromText('{"function":"read_page","arguments":{}}');
        expect(result).not.toBeNull();
        expect(result).toHaveLength(1);
        expect(result![0].function.name).toBe("read_page");
        expect(result![0].function.arguments).toBe("{}");
    });

    // Test 2: Multiple concatenated calls
    it("recovers multiple concatenated calls", () => {
        const result = recoverToolCallsFromText(
            '{"function":"click_element","arguments":{"id":5}}{"function":"type_text","arguments":{"id":3,"text":"hello"}}'
        );
        expect(result).not.toBeNull();
        expect(result).toHaveLength(2);
        expect(result![0].function.name).toBe("click_element");
        expect(result![1].function.name).toBe("type_text");
    });

    // Test 3: Prefix text
    it("recovers calls with prefix text", () => {
        const result = recoverToolCallsFromText(
            'Approved. Proceed. {"function":"read_page","arguments":{}}'
        );
        expect(result).not.toBeNull();
        expect(result).toHaveLength(1);
        expect(result![0].function.name).toBe("read_page");
    });

    // Test 4: Interleaved text
    it("recovers calls with interleaved text", () => {
        const result = recoverToolCallsFromText(
            'I\'ll click the button. {"function":"click_element","arguments":{"id":1}} Now typing. {"function":"type_text","arguments":{"id":2,"text":"hi"}}'
        );
        expect(result).not.toBeNull();
        expect(result).toHaveLength(2);
    });

    // Test 5: Consecutive dedup
    it("deduplicates consecutive identical calls", () => {
        const calls = Array(5).fill('{"function":"read_page","arguments":{}}').join("");
        const result = recoverToolCallsFromText(calls);
        expect(result).not.toBeNull();
        expect(result).toHaveLength(1);
        expect(result![0].function.name).toBe("read_page");
    });

    // Test 6: Non-consecutive kept
    it("keeps non-consecutive duplicate calls", () => {
        const result = recoverToolCallsFromText(
            '{"function":"read_page","arguments":{}}{"function":"click_element","arguments":{"id":1}}{"function":"read_page","arguments":{}}'
        );
        expect(result).not.toBeNull();
        expect(result).toHaveLength(3);
        expect(result![0].function.name).toBe("read_page");
        expect(result![1].function.name).toBe("click_element");
        expect(result![2].function.name).toBe("read_page");
    });

    // Test 7: Unknown tool name
    it("returns null for unknown tool names", () => {
        const result = recoverToolCallsFromText(
            '{"function":"destroy_all","arguments":{}}'
        );
        expect(result).toBeNull();
    });

    // Test 8: Malformed JSON
    it("returns null for malformed JSON", () => {
        const result = recoverToolCallsFromText(
            '{"function":"read_page","arguments":{broken}'
        );
        expect(result).toBeNull();
    });

    // Test 9: Pattern B
    it("recovers Pattern B calls", () => {
        const result = recoverToolCallsFromText(
            '{"tool":"click_element","id":42}'
        );
        expect(result).not.toBeNull();
        expect(result).toHaveLength(1);
        expect(result![0].function.name).toBe("click_element");
        const args = JSON.parse(result![0].function.arguments);
        expect(args.id).toBe(42);
    });

    // Test 10: Empty string
    it("returns null for empty string", () => {
        expect(recoverToolCallsFromText("")).toBeNull();
    });

    // Test 11: No JSON
    it("returns null for text without JSON", () => {
        expect(recoverToolCallsFromText("Just text with no JSON objects")).toBeNull();
    });

    // Test 12: Truncated JSON at end
    it("recovers valid call before truncated JSON", () => {
        const result = recoverToolCallsFromText(
            '{"function":"read_page","arguments":{}}{"function":"click_element","arguments":{"id":'
        );
        expect(result).not.toBeNull();
        expect(result).toHaveLength(1);
        expect(result![0].function.name).toBe("read_page");
    });

    // Test 13: Mixed valid/invalid
    it("skips invalid tool names in mixed input", () => {
        const result = recoverToolCallsFromText(
            '{"function":"read_page","arguments":{}}{"function":"unknown_tool","arguments":{}}{"function":"click_element","arguments":{"id":1}}'
        );
        expect(result).not.toBeNull();
        expect(result).toHaveLength(2);
        expect(result![0].function.name).toBe("read_page");
        expect(result![1].function.name).toBe("click_element");
    });

    // Test 14: Case insensitive
    it("handles case-insensitive tool names", () => {
        const result = recoverToolCallsFromText(
            '{"function":"READ_PAGE","arguments":{}}'
        );
        expect(result).not.toBeNull();
        expect(result).toHaveLength(1);
        expect(result![0].function.name).toBe("read_page");
    });

    // Test 15: Pattern C (functions prefix)
    it("recovers Pattern C calls with functions prefix", () => {
        const result = recoverToolCallsFromText(
            '{"to":"functions.read_page","args":{}}'
        );
        expect(result).not.toBeNull();
        expect(result).toHaveLength(1);
        expect(result![0].function.name).toBe("read_page");
    });

    // Test 16: Generated IDs
    it("generates recovered- prefixed IDs", () => {
        const result = recoverToolCallsFromText(
            '{"function":"read_page","arguments":{}}'
        );
        expect(result).not.toBeNull();
        expect(result![0].id).toMatch(/^recovered-/);
        expect(result![0].type).toBe("function");
    });

    // Test 17: Nested JSON in arguments
    it("preserves nested JSON in arguments", () => {
        const result = recoverToolCallsFromText(
            '{"function":"type_text","arguments":{"id":1,"text":"{\\"key\\":\\"val\\"}"}}'
        );
        expect(result).not.toBeNull();
        expect(result).toHaveLength(1);
        const args = JSON.parse(result![0].function.arguments);
        expect(args.id).toBe(1);
        expect(args.text).toBe('{"key":"val"}');
    });

    // Test 18: Pattern B with tool_input nesting
    it("unwraps tool_input nesting in Pattern B", () => {
        const result = recoverToolCallsFromText(
            '{"tool": "find_element", "tool_input": {"text": "Next Page"}}'
        );
        expect(result).not.toBeNull();
        expect(result).toHaveLength(1);
        expect(result![0].function.name).toBe("find_element");
        const args = JSON.parse(result![0].function.arguments);
        expect(args.text).toBe("Next Page");
        expect(args.tool_input).toBeUndefined();
    });

    // Test 19: Pattern B with input nesting
    it("unwraps input nesting in Pattern B", () => {
        const result = recoverToolCallsFromText(
            '{"tool": "click_element", "input": {"id": 75}}'
        );
        expect(result).not.toBeNull();
        expect(result).toHaveLength(1);
        const args = JSON.parse(result![0].function.arguments);
        expect(args.id).toBe(75);
        expect(args.input).toBeUndefined();
    });

    // Test 20: Pattern B with arguments nesting
    it("unwraps arguments nesting in Pattern B", () => {
        const result = recoverToolCallsFromText(
            '{"tool": "type_text", "arguments": {"id": 1, "text": "hello"}}'
        );
        expect(result).not.toBeNull();
        expect(result).toHaveLength(1);
        const args = JSON.parse(result![0].function.arguments);
        expect(args.id).toBe(1);
        expect(args.text).toBe("hello");
    });

    // Test 21: Pattern B flat args preserved (no unwrap needed)
    it("preserves flat args in Pattern B when no wrapper", () => {
        const result = recoverToolCallsFromText(
            '{"tool": "click_element", "id": 42}'
        );
        expect(result).not.toBeNull();
        const args = JSON.parse(result![0].function.arguments);
        expect(args.id).toBe(42);
    });

    // Test 22: Does not unwrap when multiple keys exist
    it("does not unwrap when multiple sibling keys exist alongside wrapper", () => {
        const result = recoverToolCallsFromText(
            '{"tool": "type_text", "tool_input": {"text": "hi"}, "extra": true}'
        );
        expect(result).not.toBeNull();
        const args = JSON.parse(result![0].function.arguments);
        // Should NOT unwrap because there are 2 keys (tool_input + extra)
        expect(args.tool_input).toEqual({ text: "hi" });
        expect(args.extra).toBe(true);
    });

    // Test 23: Unwrap does not apply to array values
    it("does not unwrap array wrapper values", () => {
        const result = recoverToolCallsFromText(
            '{"tool": "read_page", "arguments": [1, 2, 3]}'
        );
        expect(result).not.toBeNull();
        const args = JSON.parse(result![0].function.arguments);
        // Array should NOT be unwrapped — kept as-is
        expect(args.arguments).toEqual([1, 2, 3]);
    });
});
